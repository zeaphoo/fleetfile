use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DriveInfo {
    pub path: String,
    pub label: String,
    pub total_space: u64,
    pub free_space: u64,
}

pub fn list_drives() -> Vec<DriveInfo> {
    #[cfg(target_os = "windows")]
    {
        windows_drives()
    }
    #[cfg(target_os = "macos")]
    {
        macos_drives()
    }
    #[cfg(all(unix, not(any(target_os = "windows", target_os = "macos"))))]
    {
        linux_drives()
    }
}

fn statvfs_space(path: &str) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::ffi::CString;
        let c_path = CString::new(path).ok()?;
        unsafe {
            let mut stat: libc::statvfs = std::mem::zeroed();
            if libc::statvfs(c_path.as_ptr(), &mut stat) == 0 {
                let block = stat.f_frsize as u64;
                return Some((stat.f_blocks as u64 * block, stat.f_bavail as u64 * block));
            }
        }
        None
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

#[cfg(all(unix, not(any(target_os = "windows", target_os = "macos"))))]
fn linux_drives() -> Vec<DriveInfo> {
    let mut drives = Vec::new();
    let mut seen_devs = std::collections::HashSet::new();

    if let Some((total, free)) = statvfs_space("/") {
        drives.push(DriveInfo {
            path: "/".into(),
            label: "System".into(),
            total_space: total,
            free_space: free,
        });
    }

    if let Ok(mounts) = std::fs::read_to_string("/proc/mounts") {
        for line in mounts.lines() {
            let mut parts = line.split_whitespace();
            let (Some(dev), Some(mount), Some(fs)) =
                (parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            // skip pseudo filesystems, loop devices and duplicates
            if !dev.starts_with("/dev/") || mount == "/" || !seen_devs.insert(dev.to_string()) {
                continue;
            }
            if matches!(
                fs,
                "squashfs" | "tmpfs" | "devtmpfs" | "overlay" | "proc" | "sysfs"
            ) {
                continue;
            }
            if let Some((total, free)) = statvfs_space(mount) {
                if total == 0 {
                    continue;
                }
                let label = mount
                    .rsplit('/')
                    .next()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(mount)
                    .to_string();
                drives.push(DriveInfo {
                    path: mount.to_string(),
                    label,
                    total_space: total,
                    free_space: free,
                });
            }
        }
    }
    drives
}

#[cfg(target_os = "macos")]
fn macos_drives() -> Vec<DriveInfo> {
    let mut drives = Vec::new();
    if let Some((total, free)) = statvfs_space("/") {
        drives.push(DriveInfo {
            path: "/".into(),
            label: "Macintosh HD".into(),
            total_space: total,
            free_space: free,
        });
    }
    if let Ok(rd) = std::fs::read_dir("/Volumes") {
        for item in rd.flatten() {
            let path = item.path();
            let Some(path_str) = path.to_str() else { continue };
            if let Some((total, free)) = statvfs_space(path_str) {
                drives.push(DriveInfo {
                    path: path_str.to_string(),
                    label: item.file_name().to_string_lossy().into_owned(),
                    total_space: total,
                    free_space: free,
                });
            }
        }
    }
    drives
}

#[cfg(target_os = "windows")]
fn windows_drives() -> Vec<DriveInfo> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetLogicalDrives() -> u32;
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    let mask = unsafe { GetLogicalDrives() };
    let mut drives = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        let root = format!("{}:\\", letter);
        let wide: Vec<u16> = std::ffi::OsStr::new(&root)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let (mut free, mut total, mut _total_free) = (0u64, 0u64, 0u64);
        let ok = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut _total_free)
        };
        if ok != 0 {
            drives.push(DriveInfo {
                path: root.clone(),
                label: format!("{} 盘", letter),
                total_space: total,
                free_space: free,
            });
        }
    }
    drives
}
