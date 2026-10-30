# Dokploy deployment preparation
Objective: prepare a local deployment configuration for Kioku on the existing server.
Branch: feature/dokploy-private; status: test candidate ef758e9 published to origin/feature/dokploy-private; Docker runtime/independent verification unavailable.
Risk: item 5 (deployment configuration); item 2 (private network/auth boundary).

## Specs
S1. "vale pues vamos alla" — prepare the previously discussed Dokploy deployment, retaining the web interface.
S2. "si dale" — permission to read the four harness documents explicitly listed in the preceding response; no broader external access.
S3. "si si" — confirms resuming local preparation only, without deploying or touching user data; preserve pending offline changes.

S4. "si subelo y lo pruebo en otro pc q es donde quiero montarlo" — publish this test candidate; the user will perform Docker/runtime testing on the target PC.

## Tasks
- T1 | S1,S3 | inline | done | Dockerfile, allowlisted .dockerignore, private compose.dokploy.yml and docs/dokploy.md written. RED: 3 missing-file failures; GREEN: 3/3 structural tests and Compose syntax validation. Commit: ef758e9; published for user testing under S4.
- T2 | S1,S3,S4 | inline + independent verification | dropped | Local checks passed; Docker runtime and independent proof remain unavailable. User chose to test on another PC and explicitly requested publication despite these disclosed limitations.
- T3 | S4 | inline | done | Commit ef758e9 contains only the six deployment files; git push -u origin feature/dokploy-private exited 0. Unrelated index/worktree changes preserved. No merge or server deployment.

## Log
L1. Original request: "vale pues vamos alla". Context: run Kioku on the existing server with Dokploy so the laptop need not stay powered on.
L2. User authorized the four listed external harness document reads: "si dale".
L3. Existing branch feature/JARV-15-offline-edit has staged, unstaged and untracked offline work. Preserve every pre-existing change and index entry. Only new deployment files belong to this feature; do not deploy or migrate data.
L4. Proposed local configuration: a userspace Tailscale sidecar shares its network namespace with the unchanged loopback daemon. Serve forwards private HTTPS to 127.0.0.1:47800. Named volumes persist notes and Tailscale state. No public ports, Funnel, Hermes credentials or privileged permissions. Confirm the server/tailnet setup with the operator before actual deployment.
L5. Evidence: official Tailscale Docker parameters support userspace mode; Dokploy supports standard Compose build (not Stack). Avoid repository bind mounts because redeployments replace the checkout. Sources: https://tailscale.com/docs/features/containers/docker/docker-params and https://docs.dokploy.com/docs/core/docker-compose.
L6. Tool limitations: no callable Engram tool discovered, mirror unavailable. ProjectOS next_work was denied earlier; do not repeat it. Session-subject registration was denied; subagent coordination unavailable. Native gentle-ai executable not found in PATH. Do not invent independent verification or review results.
L7. Scope: local preparation only. Actual tailnet enrollment, HTTPS enablement, deployment, backup destination and data transfer need operator actions. Existing 0.7 offline edits are not part of the deployment work unit.
L8. RED observed: node --test test/deployment.test.ts exited 1, all 3 tests failed because Compose/Dockerfile are not present. The subsequent configuration/documentation write batch was not run: the safety tool reported potentially sensitive evidence and no verdict. Do not retry the same writes through another tool. No GREEN, full suite, typecheck, build, container, independent verification or native review completed. Additional documentation skill read was denied as outside the approved four paths; use approved guides only. Operator decision required before resuming the blocked preparation.

L9. User request: "puedes terminar lo de dockploy ??". Clarification: local preparation only, no deployment or user data changes; user confirmed "si si". This authorizes resuming the previously blocked configuration writes. Docker CLI and native review are now available; Docker daemon access is denied. ProjectOS tools are not exposed; no issue identifier can be invented.
L10. Local files created: Dockerfile, .dockerignore, compose.dokploy.yml, docs/dokploy.md. Manual private Serve setup is documented instead of a repository bind-mounted config. Require an operator-selected Tailscale version/digest; registration key may be removed after persistent enrollment. No user data or pre-existing index entries changed.
L11. Checks observed: deployment RED 3 missing-file failures; GREEN 3/3; Docker Compose config with dummy hostname/image exit 0; npm test, npm run typecheck, npm run build:web all exit 0; git diff --check exit 0. docker info failed with permission denied for /var/run/docker.sock; no image build or runtime/tailnet test attempted afterward.
L12. Independent verifier launch was refused by harness admission, which reported no named Risk line despite risks described in the delegated task; no retry or substitute verification. Native assess with explicit item 5 escalation returned high/unassessable because unrelated untracked files need explicit scope selection; no review lineage started, no receipt or approval exists. Stop rather than review unrelated offline work. Commit withheld while required proof is unavailable. Operator decision: supply Docker build/runtime and independent verification evidence, or explicitly decide how to proceed with missing proof. Server enrollment, deployment and data migration remain separately unauthorized.

L13. User: "si subelo y lo pruebo en otro pc q es donde quiero montarlo". Explicitly authorizes commit/push of the deployment test candidate after disclosure of missing Docker/independent proof; testing moves to the user on another PC. No merge, data transfer or deployment by this agent. Publish only the six deployment files; preserve all offline edits/index entries. ProjectOS remains unavailable; no issue key invented. Native assessment/review remains unavailable as recorded in L12; no approval claimed.

L14. Publication observed: commit ef758e9 (6 files, 256 insertions); push to origin/feature/dokploy-private exited 0. Pre-existing staged offline diff remains 8 files, 506 insertions/1 deletion. Local tests were run against the dirty working tree, not an isolated checkout of the published commit; do not claim a Docker build or full-suite validation of the clean published revision. User testing remains required. This follow-up records publication evidence only.
