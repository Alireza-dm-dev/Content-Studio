// Minimal in-memory SFTP server for exercising the upload path end to end.
import ssh2 from "ssh2";
const { Server, utils } = ssh2;
const { STATUS_CODE } = utils.sftp;

export function startSftpServer({ truncateAfter = null, rejectOutOfOrderWrites = false } = {}) {
  const files = new Map();               // path -> Buffer
  const dirs = new Set(["/"]);           // recursive mkdir walks up to "/"
  const handles = new Map();
  let nextHandle = 1;

  const { private: hostKey } = utils.generateKeyPairSync("ed25519");

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on("authentication", (ctx) => ctx.accept());
    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        acceptSession().on("sftp", (acceptSftp) => {
          const sftp = acceptSftp();
          const log = (ev, arg) => {
            if (process.env.SFTP_DEBUG) console.log("REQ:", ev, typeof arg === "string" ? arg : "");
          };

          sftp.on("REALPATH", (id, p) => {
            log("REALPATH", p);
            const resolved = p === "." ? "/" : p;
            sftp.name(id, [{ filename: resolved, longname: resolved, attrs: {} }]);
          });

          const attrsFor = (id, p) => {
            const f = files.get(p);
            if (f) {
              return sftp.attrs(id, {
                mode: 0o100644, size: f.length, uid: 0, gid: 0, atime: 0, mtime: 0,
              });
            }
            if (dirs.has(p)) {
              return sftp.attrs(id, {
                mode: 0o040755, size: 0, uid: 0, gid: 0, atime: 0, mtime: 0,
              });
            }
            return sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
          };

          sftp.on("STAT", (id, p) => { log("STAT", p); attrsFor(id, p); });
          sftp.on("LSTAT", (id, p) => { log("LSTAT", p); attrsFor(id, p); });
          sftp.on("FSTAT", (id, handle) => {
            log("FSTAT");
            const h = handles.get(handle.readUInt32BE(0));
            if (!h) return sftp.status(id, STATUS_CODE.FAILURE);
            attrsFor(id, h.path);
          });

          sftp.on("MKDIR", (id, p) => {
            log("MKDIR", p);
            dirs.add(p.replace(/\/+$/, "") || "/");
            sftp.status(id, STATUS_CODE.OK);
          });

          sftp.on("OPEN", (id, filename) => {
            log("OPEN", filename);
            const h = nextHandle++;
            handles.set(h, { path: filename, chunks: [], written: 0 });
            files.set(filename, Buffer.alloc(0));
            const buf = Buffer.alloc(4);
            buf.writeUInt32BE(h, 0);
            sftp.handle(id, buf);
          });

          sftp.on("WRITE", (id, handle, offset, data) => {
            const h = handles.get(handle.readUInt32BE(0));
            if (!h) return sftp.status(id, STATUS_CODE.FAILURE);
            // Simulate a mid-transfer cut: acknowledge but discard past the limit.
            if (truncateAfter !== null && offset >= truncateAfter) {
              return sftp.status(id, STATUS_CODE.OK);
            }
            // Stands in for a server that cannot handle fastPut parallel writes.
            if (rejectOutOfOrderWrites && offset !== h.written) {
              return sftp.status(id, STATUS_CODE.FAILURE);
            }
            h.written = offset + data.length;
            h.chunks.push({ offset, data: Buffer.from(data) });
            sftp.status(id, STATUS_CODE.OK);
          });

          sftp.on("CLOSE", (id, handle) => {
            log("CLOSE");
            const key = handle.readUInt32BE(0);
            const h = handles.get(key);
            if (h) {
              const end = h.chunks.reduce((m, c) => Math.max(m, c.offset + c.data.length), 0);
              const out = Buffer.alloc(end);
              for (const c of h.chunks) c.data.copy(out, c.offset);
              files.set(h.path, out);
              handles.delete(key);
            }
            sftp.status(id, STATUS_CODE.OK);
          });

          sftp.on("REMOVE", (id, p) => {
            log("REMOVE", p);
            files.delete(p);
            sftp.status(id, STATUS_CODE.OK);
          });

          sftp.on("SETSTAT", (id) => sftp.status(id, STATUS_CODE.OK));
          sftp.on("FSETSTAT", (id) => sftp.status(id, STATUS_CODE.OK));
        });
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: server.address().port, files, close: () => server.close() });
    });
  });
}
