export function createGuestReelsInvite() {
  const seen = new Set();
  return (id, status, dismissed) => {
    if (status !== 'unauthenticated' || !id || dismissed) return false;
    seen.add(id);
    return seen.size >= 3;
  };
}
