#!/usr/bin/env python3
"""Validate ZIP metadata and extract one approved media file at a time."""

import json
import os
import pathlib
import stat
import sys
import zipfile

MAX_FILES = 500
MAX_ARCHIVE_ENTRIES = 10000
MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024
MAX_IMAGE_BYTES = 100 * 1024 * 1024
MAX_VIDEO_BYTES = 500 * 1024 * 1024
MAX_RATIO = 250
CHUNK = 1024 * 1024


def _entry_path_is_safe(info):
    name = info.filename
    if not name or "\\" in name or ":" in name or name.startswith("/"):
        return False
    if any(ord(char) < 32 or ord(char) == 127 for char in name):
        return False
    parts = name.split("/")
    if info.is_dir() and parts[-1] == "":
        parts = parts[:-1]
    if not parts or any(part in ("", ".", "..") for part in parts):
        return False
    mode = (info.external_attr >> 16) & 0o170000
    return mode != stat.S_IFLNK and not (info.flag_bits & 0x1)


def _media_kind(info):
    suffix = pathlib.PurePosixPath(info.filename).suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        return "image", MAX_IMAGE_BYTES
    if suffix == ".mp4":
        return "video", MAX_VIDEO_BYTES
    return None, None


def _display_name(name):
    base = pathlib.PurePosixPath(name).name
    clean = "".join(char for char in base if ord(char) >= 32 and ord(char) != 127)
    return clean[:180] or "media file"


def inspect_archive(archive):
    with zipfile.ZipFile(archive, "r") as zf:
        infos = zf.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise ValueError("The ZIP contains too many entries.")

        entries = []
        total_bytes = 0
        ignored = 0
        for index, info in enumerate(infos):
            if not _entry_path_is_safe(info):
                raise ValueError("The ZIP contains an unsafe or encrypted entry.")

            size = int(info.file_size)
            compressed = int(info.compress_size)
            if size < 0 or compressed < 0:
                raise ValueError("The ZIP contains invalid size metadata.")
            if info.is_dir():
                ignored += 1
                continue

            total_bytes += size
            if total_bytes > MAX_TOTAL_BYTES:
                raise ValueError("The ZIP expands beyond the 5 GB safety limit.")
            if size > 1024 * 1024 and size / max(compressed, 1) > MAX_RATIO:
                raise ValueError("The ZIP contains an entry with an unsafe compression ratio.")

            parts = info.filename.rstrip("/").split("/")
            if any(part.startswith(".") for part in parts) or "__MACOSX" in parts:
                ignored += 1
                continue

            kind, size_limit = _media_kind(info)
            if kind is None:
                ignored += 1
                continue
            if size <= 0 or size > size_limit:
                raise ValueError("A supported media file is empty or exceeds its size limit.")

            entries.append({
                "index": index,
                "name": _display_name(info.filename),
                "size": size,
                "kind": kind,
            })
            if len(entries) > MAX_FILES:
                raise ValueError("A ZIP may contain at most 500 supported JPG/MP4 files.")

        return {"files": entries, "ignoredCount": ignored, "totalBytes": total_bytes}


def extract_one(archive, index, destination):
    destination = pathlib.Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with zipfile.ZipFile(archive, "r") as zf:
            manifest = inspect_archive(archive)
            index = int(index)
            item = next((entry for entry in manifest["files"] if entry["index"] == index), None)
            if item is None:
                raise ValueError("The requested ZIP entry is not an allowed media file.")
            info = zf.infolist()[index]
            written = 0
            limit = MAX_VIDEO_BYTES if item["kind"] == "video" else MAX_IMAGE_BYTES
            with zf.open(info, "r") as source, open(destination, "xb") as target:
                created = True
                while True:
                    chunk = source.read(CHUNK)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > limit or written > info.file_size:
                        raise ValueError("Extracted media exceeded its declared size limit.")
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            if written != info.file_size:
                raise ValueError("ZIP entry size did not match the archive manifest.")
    except Exception:
        if created:
            try:
                destination.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def main():
    if len(sys.argv) < 3:
        raise ValueError("Usage: bulk-import-zip.py list ZIP | extract ZIP INDEX DESTINATION")
    action = sys.argv[1]
    archive = sys.argv[2]
    if action == "list" and len(sys.argv) == 3:
        print(json.dumps(inspect_archive(archive)))
    elif action == "extract" and len(sys.argv) == 5:
        extract_one(archive, sys.argv[3], sys.argv[4])
        print("{}")
    else:
        raise ValueError("Invalid ZIP helper arguments.")


if __name__ == "__main__":
    try:
        main()
    except (zipfile.BadZipFile, OSError, RuntimeError):
        print("The ZIP archive could not be read safely.", file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(str(error)[:300], file=sys.stderr)
        sys.exit(1)
