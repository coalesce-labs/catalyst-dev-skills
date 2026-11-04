// The bounded reader's child: reads a JSON request list on stdin and reports each result on stdout.
// The parent kills it at the deadline. It checks each path's type itself, so a special file swapped
// in after the parent's check is still reported, not opened. An `append` writes `text` to the end of
// a regular file, creating it when it is missing.
import { appendFileSync, closeSync, constants, openSync, readFileSync, statSync, writeSync } from "node:fs";

const kindOf = (st) => st.isFIFO() ? "named pipe" : st.isSocket() ? "socket"
  : st.isCharacterDevice() ? "character device" : st.isBlockDevice() ? "block device" : null;
const emit = (line) => writeSync(1, `${line}\n`);

for (const req of JSON.parse(readFileSync(0, "utf8"))) {
  emit(`S ${req.i}`);
  let result;
  try {
    const st = statSync(req.path, { throwIfNoEntry: req.op !== "append" });
    const special = st && kindOf(st);
    if (special) result = { kind: "special", special };
    else if (req.op === "append") { appendFileSync(req.path, req.text); result = { kind: "file" }; }
    else if (st.isDirectory()) result = { kind: "dir" };
    else if (req.op === "read") result = { kind: "file", text: readFileSync(req.path, "utf8") };
    else { closeSync(openSync(req.path, constants.O_RDONLY)); result = { kind: "file" }; }
  } catch (err) {
    result = err.code === "ENOENT" || err.code === "ENOTDIR"
      ? { kind: "missing", code: err.code }
      : { kind: "error", code: err.code || "ERROR", message: String(err.message) };
  }
  emit(`D ${req.i} ${JSON.stringify(result)}`);
}
