# Gather Kubernetes deployment

This directory is a **single-backend-instance Kubernetes baseline** for Gather.
It is suitable for a single-node development cluster or a controlled small deployment. It is **not** a highly available production topology yet because mediasoup rooms/call state are in memory and the current application does not have distributed Socket.IO/call coordination.

## Build images

Build the two application images from the repository root:

```powershell
docker build -f Dockerfile.backend -t gather-backend:local .
docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost:30400 -f Dockerfile.frontend -t gather-frontend:local .
```

For a remote cluster, replace the frontend API URL with the browser-reachable backend URL (normally an HTTPS API hostname) and push both images to your registry.

## Create the required secrets

Do **not** commit real secrets to Git. Create the app secret in the cluster:

```powershell
kubectl create namespace gather
kubectl -n gather create secret generic gather-app-secrets `
  --from-literal=DATABASE_URL='postgresql://social:CHANGE_ME@postgres:5432/instagram_clone?schema=public' `
  --from-literal=AUTH_SECRET='CHANGE_ME_32_PLUS_RANDOM_CHARS' `
  --from-literal=INTERNAL_AUTH_SECRET='CHANGE_ME_DIFFERENT_RANDOM_SECRET' `
  --from-literal=MINIO_ROOT_USER='gatheradmin' `
  --from-literal=MINIO_ROOT_PASSWORD='CHANGE_ME_LONG_PASSWORD' `
  --from-literal=MINIO_ACCESS_KEY='gatheradmin' `
  --from-literal=MINIO_SECRET_KEY='CHANGE_ME_LONG_PASSWORD'
```

Google OAuth is optional. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the same secret if you want Google sign-in enabled.

Create the AIStor license secret from the license file you already have:

```powershell
kubectl -n gather create secret generic gather-minio-license --from-file=minio.license=./minio.license
```

The license file is intentionally **not** included in this repository.

## Apply

Build/import the images into your cluster first. Then:

```powershell
kubectl apply -k k8s
```

Run database migrations once:

```powershell
kubectl -n gather wait --for=condition=ready pod -l app=postgres --timeout=180s
kubectl -n gather wait --for=condition=ready pod -l app=minio --timeout=180s
kubectl -n gather wait --for=condition=ready pod -l app=gather-backend --timeout=180s
kubectl -n gather delete job gather-db-migrate --ignore-not-found
kubectl apply -f k8s/55-migrate-job.yaml
kubectl -n gather wait --for=condition=complete job/gather-db-migrate --timeout=180s
```

Then inspect:

```powershell
kubectl -n gather get pods,svc,pvc
```

## Local access

With a Docker Desktop/minikube-style node-port setup:

- Gather frontend: `http://localhost:30080`
- Gather backend: `http://localhost:30400/health`
- MinIO S3 API: `http://localhost:30900`
- MinIO Console: `http://localhost:30901`

For signed media URLs to work from a browser, `MINIO_PUBLIC_ENDPOINT` in `20-minio.yaml` must be reachable from the browser. For a real deployment, replace the local NodePort URL with the public S3/CDN hostname.

For mediasoup, set `MEDIASOUP_ANNOUNCED_ADDRESS` in `30-backend.yaml` to an address reachable by the browsers. The backend uses `hostNetwork: true` so the mediasoup UDP/TCP range is bound directly on the node. Open the configured RTC ports in the node firewall.

## Production limitations

- Backend replicas must remain at `1` until shared Socket.IO/call coordination is added.
- PostgreSQL should move to a managed HA database for serious production use.
- MinIO should use appropriate durable storage/replication or a managed S3-compatible service for serious production use.
- The current media `MINIO_PUBLIC_ENDPOINT` should normally be a CDN/object-storage hostname, not the internal MinIO service.
- HTTPS, ingress, TURN, secret rotation, backups, monitoring, logging, and image scanning still need deployment-specific configuration.
