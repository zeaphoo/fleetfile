use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use serde_json::json;

type OutTx = tokio::sync::mpsc::UnboundedSender<String>;

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    kill: Arc<AtomicBool>,
}

/// Multi-session PTY hub fed by the /api/pty WebSocket.
#[derive(Clone, Default)]
pub struct PtyHub {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PtyMsg {
    Spawn { id: String, cwd: String, cols: u16, rows: u16 },
    Write { id: String, data: String },
    Resize { id: String, cols: u16, rows: u16 },
    Kill { id: String },
}

impl PtyHub {
    pub fn spawn(&self, id: &str, cwd: &str, cols: u16, rows: u16, out: OutTx) {
        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(p) => p,
            Err(e) => {
                let _ = out.send(json!({"type":"exit","id":id,"code":-1,"error":e.to_string()}).to_string());
                return;
            }
        };
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        let child = match pair.slave.spawn_command(cmd) {
            Ok(c) => c,
            Err(e) => {
                let _ = out.send(json!({"type":"exit","id":id,"code":-1,"error":e.to_string()}).to_string());
                return;
            }
        };
        drop(pair.slave);

        let mut reader = match pair.master.try_clone_reader() {
            Ok(r) => r,
            Err(e) => {
                let _ = out.send(json!({"type":"exit","id":id,"code":-1,"error":e.to_string()}).to_string());
                return;
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(w) => w,
            Err(_) => {
                let _ = out.send(json!({"type":"exit","id":id,"code":-1,"error":"no writer"}).to_string());
                return;
            }
        };

        let kill = Arc::new(AtomicBool::new(false));
        let kill2 = kill.clone();
        let id2 = id.to_string();
        let out2 = out.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 8192];
            loop {
                if kill2.load(Ordering::Relaxed) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                        let _ = out2.send(
                            json!({"type":"output","id":id2,"data":text}).to_string(),
                        );
                    }
                    Err(_) => break,
                }
            }
            let _ = out2.send(json!({"type":"exit","id":id2,"code":0}).to_string());
        });

        self.sessions.lock().unwrap().insert(
            id.to_string(),
            PtySession {
                master: pair.master,
                writer,
                kill,
            },
        );
    }

    pub fn write(&self, id: &str, data: &str) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(id) {
            let _ = s.writer.write_all(data.as_bytes());
            let _ = s.writer.flush();
        }
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(id) {
            let _ = s.master.resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }

    pub fn kill(&self, id: &str) {
        if let Some(s) = self.sessions.lock().unwrap().remove(id) {
            s.kill.store(true, Ordering::Relaxed);
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<String> = self
            .sessions
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        for id in ids {
            self.kill(&id);
        }
    }
}
