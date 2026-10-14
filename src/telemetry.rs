//! Diagnostic Telemetry & Persistent Disk Logger
//!
//! Provides persistent file logging next to the executable (in `Logs/`),
//! an in-memory ring buffer for the in-app live console, and zero-dependency
//! native Windows RAM and CPU utilization sampling.

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::sync::OnceLock;

static TELEMETRY_ENABLED: AtomicBool = AtomicBool::new(true);
static LOG_BUFFER: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
static LOG_FILE: OnceLock<Mutex<Option<File>>> = OnceLock::new();
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

const MAX_IN_MEMORY_LOGS: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetrySnapshot {
    pub total_ram_mb: u64,
    pub used_ram_mb: u64,
    pub available_ram_mb: u64,
    pub ram_percent: f32,
    pub app_ram_mb: u64,
    pub cpu_percent: f32,
    pub timestamp: String,
}

// Windows native FFI structs and functions
#[cfg(windows)]
mod win32 {
    #[repr(C)]
    #[allow(non_snake_case)]
    pub struct MEMORYSTATUSEX {
        pub dwLength: u32,
        pub dwMemoryLoad: u32,
        pub ullTotalPhys: u64,
        pub ullAvailPhys: u64,
        pub ullTotalPageFile: u64,
        pub ullAvailPageFile: u64,
        pub ullTotalVirtual: u64,
        pub ullAvailVirtual: u64,
        pub ullAvailExtendedVirtual: u64,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    pub struct PROCESS_MEMORY_COUNTERS {
        pub cb: u32,
        pub PageFaultCount: u32,
        pub PeakWorkingSetSize: usize,
        pub WorkingSetSize: usize,
        pub QuotaPeakPagedPoolUsage: usize,
        pub QuotaPagedPoolUsage: usize,
        pub QuotaPeakNonPagedPoolUsage: usize,
        pub QuotaNonPagedPoolUsage: usize,
        pub PagefileUsage: usize,
        pub PeakPagefileUsage: usize,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    #[derive(Default, Copy, Clone)]
    pub struct FILETIME {
        pub dwLowDateTime: u32,
        pub dwHighDateTime: u32,
    }

    impl FILETIME {
        pub fn to_u64(&self) -> u64 {
            ((self.dwHighDateTime as u64) << 32) | (self.dwLowDateTime as u64)
        }
    }

    extern "system" {
        pub fn GlobalMemoryStatusEx(lpBuffer: *mut MEMORYSTATUSEX) -> i32;
        pub fn GetCurrentProcess() -> isize;
        pub fn K32GetProcessMemoryInfo(
            hProcess: isize,
            ppsmemCounters: *mut PROCESS_MEMORY_COUNTERS,
            cb: u32,
        ) -> i32;
        pub fn GetSystemTimes(
            lpIdleTime: *mut FILETIME,
            lpKernelTime: *mut FILETIME,
            lpUserTime: *mut FILETIME,
        ) -> i32;
    }
}

// Previous CPU sampling times
static PREV_CPU_TIMES: OnceLock<Mutex<(u64, u64)>> = OnceLock::new();

pub fn set_telemetry_enabled(enabled: bool) {
    TELEMETRY_ENABLED.store(enabled, Ordering::SeqCst);
}

pub fn is_telemetry_enabled() -> bool {
    TELEMETRY_ENABLED.load(Ordering::SeqCst)
}

/// Resolves or initializes the `Logs/` directory next to the executable or in the current working directory.
pub fn get_log_dir() -> PathBuf {
    LOG_DIR
        .get_or_init(|| {
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."));

            let logs_path = exe_dir.join("Logs");
            let _ = fs::create_dir_all(&logs_path);
            logs_path
        })
        .clone()
}

/// Initialize the persistent logger on application start.
pub fn init_logger() {
    let logs_dir = get_log_dir();
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let log_file_name = format!("rvfx_diagnostic_{}.log", timestamp);
    let log_file_path = logs_dir.join(log_file_name);

    let file_opt = OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(&log_file_path)
        .ok();

    LOG_FILE.get_or_init(|| Mutex::new(file_opt));
    LOG_BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_IN_MEMORY_LOGS)));

    log_info(format!(
        "Diagnostic Telemetry Logger initialized. Log directory: {}",
        logs_dir.display()
    ));
}

/// Sample current system Memory (RAM) and CPU usage
pub fn sample_telemetry() -> TelemetrySnapshot {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    #[cfg(windows)]
    {
        use std::mem::size_of;

        let mut total_ram_mb = 0u64;
        let mut available_ram_mb = 0u64;
        let mut used_ram_mb = 0u64;
        let mut ram_percent = 0.0f32;
        let mut app_ram_mb = 0u64;
        let mut cpu_percent = 0.0f32;

        unsafe {
            // 1. System RAM via GlobalMemoryStatusEx
            let mut mem_status = win32::MEMORYSTATUSEX {
                dwLength: size_of::<win32::MEMORYSTATUSEX>() as u32,
                dwMemoryLoad: 0,
                ullTotalPhys: 0,
                ullAvailPhys: 0,
                ullTotalPageFile: 0,
                ullAvailPageFile: 0,
                ullTotalVirtual: 0,
                ullAvailVirtual: 0,
                ullAvailExtendedVirtual: 0,
            };

            if win32::GlobalMemoryStatusEx(&mut mem_status) != 0 {
                total_ram_mb = mem_status.ullTotalPhys / (1024 * 1024);
                available_ram_mb = mem_status.ullAvailPhys / (1024 * 1024);
                used_ram_mb = total_ram_mb.saturating_sub(available_ram_mb);
                ram_percent = mem_status.dwMemoryLoad as f32;
            }

            // 2. Application Process RAM via K32GetProcessMemoryInfo
            let mut proc_mem = win32::PROCESS_MEMORY_COUNTERS {
                cb: size_of::<win32::PROCESS_MEMORY_COUNTERS>() as u32,
                PageFaultCount: 0,
                PeakWorkingSetSize: 0,
                WorkingSetSize: 0,
                QuotaPeakPagedPoolUsage: 0,
                QuotaPagedPoolUsage: 0,
                QuotaPeakNonPagedPoolUsage: 0,
                QuotaNonPagedPoolUsage: 0,
                PagefileUsage: 0,
                PeakPagefileUsage: 0,
            };

            let h_proc = win32::GetCurrentProcess();
            if win32::K32GetProcessMemoryInfo(
                h_proc,
                &mut proc_mem,
                size_of::<win32::PROCESS_MEMORY_COUNTERS>() as u32,
            ) != 0
            {
                app_ram_mb = (proc_mem.WorkingSetSize as u64) / (1024 * 1024);
            }

            // 3. System CPU via GetSystemTimes
            let mut idle_time = win32::FILETIME::default();
            let mut kernel_time = win32::FILETIME::default();
            let mut user_time = win32::FILETIME::default();

            if win32::GetSystemTimes(&mut idle_time, &mut kernel_time, &mut user_time) != 0 {
                let current_idle = idle_time.to_u64();
                let current_total = kernel_time.to_u64() + user_time.to_u64();

                let cpu_state = PREV_CPU_TIMES.get_or_init(|| Mutex::new((current_idle, current_total)));
                if let Ok(mut prev) = cpu_state.lock() {
                    let (prev_idle, prev_total) = *prev;
                    let delta_idle = current_idle.saturating_sub(prev_idle);
                    let delta_total = current_total.saturating_sub(prev_total);

                    if delta_total > 0 {
                        let usage = (1.0 - (delta_idle as f64 / delta_total as f64)) * 100.0;
                        cpu_percent = (usage as f32).clamp(0.0, 100.0);
                    }
                    *prev = (current_idle, current_total);
                }
            }
        }

        TelemetrySnapshot {
            total_ram_mb,
            used_ram_mb,
            available_ram_mb,
            ram_percent,
            app_ram_mb,
            cpu_percent,
            timestamp: now,
        }
    }

    #[cfg(not(windows))]
    {
        TelemetrySnapshot {
            total_ram_mb: 16384,
            used_ram_mb: 8192,
            available_ram_mb: 8192,
            ram_percent: 50.0,
            app_ram_mb: 256,
            cpu_percent: 5.0,
            timestamp: now,
        }
    }
}

/// Log a message with a specific severity level. Writes to disk and stores in memory.
pub fn log_with_level(level: &str, msg: impl AsRef<str>) {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let telemetry_suffix = if is_telemetry_enabled() {
        let t = sample_telemetry();
        format!(
            " [RAM: {:.1}/{:.1} GB ({}%) | App: {} MB | CPU: {:.0}%]",
            t.used_ram_mb as f64 / 1024.0,
            t.total_ram_mb as f64 / 1024.0,
            t.ram_percent as u32,
            t.app_ram_mb,
            t.cpu_percent
        )
    } else {
        String::new()
    };

    let formatted_line = format!("[{}] [{}]{} {}", now, level, telemetry_suffix, msg.as_ref());

    // Print to stderr for terminal/dev
    eprintln!("{}", formatted_line);

    // Save to in-memory buffer for GUI console
    if let Some(buf_mutex) = LOG_BUFFER.get() {
        if let Ok(mut buf) = buf_mutex.lock() {
            if buf.len() >= MAX_IN_MEMORY_LOGS {
                buf.pop_front();
            }
            buf.push_back(formatted_line.clone());
        }
    }

    // Write to persistent log file on disk
    if let Some(file_mutex) = LOG_FILE.get() {
        if let Ok(mut file_opt) = file_mutex.lock() {
            if let Some(ref mut file) = *file_opt {
                let _ = writeln!(file, "{}", formatted_line);
                let _ = file.flush();
            }
        }
    }
}

pub fn log_info(msg: impl AsRef<str>) {
    log_with_level("INFO", msg);
}

pub fn log_warn(msg: impl AsRef<str>) {
    log_with_level("WARN", msg);
}

pub fn log_error(msg: impl AsRef<str>) {
    log_with_level("ERROR", msg);
}

pub fn log_debug(msg: impl AsRef<str>) {
    log_with_level("DEBUG", msg);
}

/// Get recent log entries from the in-memory ring buffer
pub fn get_recent_logs(limit: Option<usize>) -> Vec<String> {
    if let Some(buf_mutex) = LOG_BUFFER.get() {
        if let Ok(buf) = buf_mutex.lock() {
            let max_count = limit.unwrap_or(MAX_IN_MEMORY_LOGS);
            let skip_count = buf.len().saturating_sub(max_count);
            return buf.iter().skip(skip_count).cloned().collect();
        }
    }
    Vec::new()
}

/// Clear in-memory log buffer
pub fn clear_in_memory_logs() {
    if let Some(buf_mutex) = LOG_BUFFER.get() {
        if let Ok(mut buf) = buf_mutex.lock() {
            buf.clear();
        }
    }
}
