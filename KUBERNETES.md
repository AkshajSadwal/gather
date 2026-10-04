# Kubernetes deployment

Gather now includes container images and a Kubernetes baseline under `k8s/`.

## Important architecture note

The current application deliberately runs **one backend replica** because mediasoup rooms, active calls, busy-user state, and Socket.IO presence are stored in the backend process. Scaling the backend horizontally requires a shared Socket.IO adapter/distributed coordination strategy and media-server routing design first.

Kubernetes therefore improves packaging, restart behavior, probes, persistent volumes, and deployment repeatability, but it does **not** make the current backend horizontally scalable by itself.

## Components

```text
Kubernetes
├── frontend Deployment + NodePort :30080
├── backend Deployment + NodePort :30400
│   └── hostNetwork for mediasoup RTP ports 40000-49999
├── postgres StatefulSet + PVC :5432
└── minio StatefulSet + PVC
    ├── S3 API NodePort :30900
    └── Console NodePort :30901
```

The backend uses `/health/live` for liveness and `/health/ready` for dependency-aware readiness. The frontend uses `/` for both probes.

## Media delivery

Post/Reel/Story media remains private in MinIO. The backend authorizes media access and emits short-lived presigned URLs. In a real deployment, set `MINIO_PUBLIC_ENDPOINT` to the browser-reachable object-storage or CDN endpoint rather than an internal Kubernetes service name.

## Mediasoup networking

`hostNetwork: true` is used for the single backend replica so mediasoup can bind the configured UDP/TCP RTC port range directly on the node. Set `MEDIASOUP_ANNOUNCED_ADDRESS` to the IP/hostname that browsers can reach and allow the configured RTC range in the node/network firewall.

For a serious public deployment, put the web/API behind HTTPS ingress and add TURN as required by the network topology.

The migration Job is intentionally not part of the default `kustomization.yaml`: Kubernetes Jobs have immutable pod templates, so applying the same named Job after an image/template change can fail. Run `kubectl apply -f k8s/55-migrate-job.yaml` explicitly whenever you deploy a new migration state.
