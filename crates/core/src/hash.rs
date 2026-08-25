use sha2::Digest;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;

use crate::CoreError;

#[derive(Debug, Clone, Serialize)]
pub struct HashInfo {
    pub algo: String,
    pub hash: String,
    pub size: u64,
}

/// Hash a file with the given algorithm ("sha256" | "sha1" | "md5"), streamed
/// in chunks.
pub fn hash_file(path: &str, algo: &str) -> Result<HashInfo, CoreError> {
    let mut file = File::open(Path::new(path))?;
    let mut buf = vec![0u8; 1024 * 1024];
    match algo {
        "md5" => {
            let mut h = md5::Md5::new();
            loop {
                let n = file.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                h.update(&buf[..n]);
            }
            let size = file.metadata()?.len();
            Ok(HashInfo {
                algo: algo.into(),
                hash: hex::encode(h.finalize()),
                size,
            })
        }
        "sha1" => {
            let mut h = sha1::Sha1::new();
            loop {
                let n = file.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                h.update(&buf[..n]);
            }
            let size = file.metadata()?.len();
            Ok(HashInfo {
                algo: algo.into(),
                hash: hex::encode(h.finalize()),
                size,
            })
        }
        _ => {
            // default: sha256
            let mut h = sha2::Sha256::new();
            loop {
                let n = file.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                h.update(&buf[..n]);
            }
            let size = file.metadata()?.len();
            Ok(HashInfo {
                algo: "sha256".into(),
                hash: hex::encode(h.finalize()),
                size,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_known_string() {
        let dir = std::env::temp_dir().join(format!("fleetfile_hash_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.txt");
        std::fs::write(&p, "abc").unwrap();
        let sha256 = hash_file(p.to_str().unwrap(), "sha256").unwrap();
        // sha256("abc")
        assert_eq!(
            sha256.hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let md5 = hash_file(p.to_str().unwrap(), "md5").unwrap();
        assert_eq!(md5.hash, "900150983cd24fb0d6963f7d28e17f72");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
