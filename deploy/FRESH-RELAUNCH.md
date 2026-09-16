# Fresh town, local observation first

Owner decision: discard the old history instead of archiving it. Open the full UI locally for observation before production work. AI minds must remain disconnected. The accepted visual baseline is Three B with corrected rain motion. Test suites and release gates remain skipped by request.

## Current local run

- Full UI: http://127.0.0.1:8768/
- Launcher: `/tmp/sj-three-town/serve-wide.mjs`
- macOS job: `local.sanjunipero.preview`, submitted through `launchctl` so the server is independent of the chat terminal. Logs: `/tmp/sj-three-town/server.log` and `server-error.log`. Inspect with `launchctl list local.sanjunipero.preview`. Stop with `launchctl remove local.sanjunipero.preview` before starting another server on 8768. This job does not install a login-start plist.
- Fresh database: `/tmp/sj-three-town/wide-town.db`
- Scripted behavior only. No cast factory, live imports, narrator database, or mind memory directory is passed to the launcher.
- Interiors, builders and bridge are enabled, with 16 lamps. The clock starts on day 0 without the review proxy or history fast-forward.

The two obsolete local preview databases and their SQLite sidecars were deleted. Their allocated size before deletion was 139,788,288 bytes (133.31 MiB). The fresh database and local art cache use new disk space as the town runs. No production archive had been created, and production data has not been changed.

## Later production relaunch

Production launch and data reset remain pending owner go after local observation. Do not use the previous archive-and-resume plan. The owner no longer wants historical world or character memory retained.

Before any production deletion, identify the actual data mounts and stop their writers. Preserve the spending ledger (`_ops.db`) and budget limits, reusable art sources, and model weights. Do not delete a whole data volume before separating those files from historical world data. Do not enable AI minds as a side effect of launching the viewer.

`deploy/compose.relaunch.yaml` can select a distinct new data volume for a later launch. It has not been applied. With discarded history, the previous world's history cannot be used for rollback.
