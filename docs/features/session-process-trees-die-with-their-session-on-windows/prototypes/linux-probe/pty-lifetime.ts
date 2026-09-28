import { createPtySession } from "../src/pty/pty"
const t0 = Date.now()
const p = createPtySession("bash", ["-c", "echo hi; sleep 1; echo one; sleep 1; echo two; trap 'echo GOT_HUP' HUP; sleep 3; echo three"], { cwd: "/tmp", env: process.env as any })
p.onData(d => console.log(Date.now()-t0, "DATA", JSON.stringify(String(d))))
p.onExit(e => console.log(Date.now()-t0, "EXIT", JSON.stringify(e)))
setTimeout(() => process.exit(0), 6000)
