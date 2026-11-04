#!/usr/bin/env python3
"""Remove everything gateway-setup/provision.py created, in reverse order.

    ./gateway-setup/teardown.py              undeploy and delete the Bank of Asgard resources
    ./gateway-setup/teardown.py --dry-run    show what would be removed
    ./gateway-setup/teardown.py --force      also remove same-named resources it did not create

Only resources whose description carries provision.py's marker are touched (unless
--force); a provider reused through EXISTING_LLM_PROVIDER_ID is never deleted, and the
project is left in place. Same gateway.env as provision.py.
"""
from __future__ import annotations

import argparse
import sys

import platform_api as pa
import provision as pv
from platform_api import MANAGED_MARKER, api


def targets() -> list[tuple[str, str]]:
    """(collection, id), in deletion order: consumers before what they point at."""
    found = [("applications", c["app"]) for c in pv.CONSUMERS.values()]
    found += [("rest-apis", pv.REST_API["id"]), ("mcp-proxies", pv.MCP_PROXY["id"])]
    found += [("llm-proxies", p["id"]) for p in reversed(list(pv.PROXIES.values()))]
    if not pv.EXISTING_PROVIDER_ID:
        found.append(("llm-providers", pv.PROVIDER_ID))
    return found


def undeploy_all(resource: str, rid: str, dry_run: bool) -> bool:
    """A deployed resource cannot be deleted (409 DEPLOYMENT_ACTIVE): undeploy it from
    every gateway first."""
    if resource == "applications":
        return True
    status, resp = api("GET", f"/{resource}/{rid}/deployments")
    if status != 200:
        print(f"  WARNING: could not list deployments of {rid}: {status} {resp}")
        return False
    ok = True
    for dep in pa.items(resp):
        if dep.get("status") in ("UNDEPLOYED", "ARCHIVED"):
            continue
        dep_id = dep.get("deploymentId") or dep.get("id")
        gateway_id = dep.get("gatewayId")
        if dry_run:
            print(f"  would undeploy {rid} from {gateway_id}")
            continue
        status, resp = api("POST", f"/{resource}/{rid}/deployments/{dep_id}/undeploy?gatewayId={gateway_id}")
        if status in (200, 201, 202, 204):
            print(f"  undeployed {rid} from {gateway_id}")
        else:
            print(f"  WARNING: undeploy of {rid} from {gateway_id} failed: {status} {resp}")
            ok = False
    return ok


def remove(resource: str, rid: str, force: bool, dry_run: bool) -> bool:
    status, current = api("GET", f"/{resource}/{rid}")
    if status == 404:
        print(f"  absent     {resource:<14} {rid}")
        return True
    if status != 200:
        print(f"  WARNING    {resource} {rid}: {status} {current}")
        return False
    if MANAGED_MARKER not in (current.get("description") or "") and not force:
        print(f"  kept       {resource:<14} {rid} — not created by gateway-setup (--force to remove anyway)")
        return True
    if not undeploy_all(resource, rid, dry_run):
        return False
    if dry_run:
        print(f"  would delete {resource} {rid}")
        return True
    status, resp = api("DELETE", f"/{resource}/{rid}")
    if status in (200, 202, 204):
        print(f"  deleted    {resource:<14} {rid}")
        return True
    print(f"  WARNING    could not delete {resource} {rid}: {status} {resp}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="show what would be removed")
    parser.add_argument("--force", action="store_true", help="also remove same-named resources not created by gateway-setup")
    args = parser.parse_args()

    pa.login()
    print(f"### removing Bank of Asgard gateway resources (prefix {pv.PREFIX!r})")
    failures = sum(not remove(resource, rid, args.force, args.dry_run) for resource, rid in targets())
    if not args.dry_run and pv.STATE_FILE.exists():
        pv.STATE_FILE.unlink()
        print(f"  removed {pv.STATE_FILE.relative_to(pa.ROOT)} (stored URLs and keys)")
    if failures:
        sys.exit(f"\n{failures} resource(s) could not be removed — see the warnings above")
    print("\ndone. The agents' .env files still point at the gateway: set gateway.enabled: false in "
          "llm_config.yaml and MCP_GATEWAY_ENABLED=false, or restore the .env.gateway.bak backups.")


if __name__ == "__main__":
    main()
