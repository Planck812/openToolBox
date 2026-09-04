//! 久坐提醒配置：默认值、store 读写、屏蔽时段解析/校验。
//!
//! 所有对 store 的「读-改-写」经 `store_lock` 串行化（照 sticky 的 store_lock 模式），
//! 防止并发下配置互相覆盖。配置读写失败一律回退默认值，不阻断启动。

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

/// store 中的久坐提醒配置 key。
const SEDENTARY_STORE_KEY: &str = "sedentary:config";
/// store 文件名。
const SEDENTARY_STORE_FILE: &str = "sedentary.json";
/// 默认开关：开启。
pub(super) const DEFAULT_ENABLED: bool = true;
/// 默认视频播放开关：开启。
const DEFAULT_VIDEO_ENABLED: bool = true;
/// 默认间隔时长（分钟）。
pub(super) const DEFAULT_REMIND_MINUTES: u64 = 45;
/// 点「稍后」后再次提醒的间隔（秒）。MVP 固定，不配置化。
pub(super) const DEFAULT_SNOOZE_SECONDS: u64 = 5 * 60;
/// 默认闲置重置阈值（分钟）。
pub(super) const DEFAULT_IDLE_RESET_MINUTES: u64 = 5;
/// 默认提醒文案。
pub(super) const DEFAULT_MESSAGE: &str = "起来活动一下";
/// 间隔时长可配置范围（分钟）。
pub(super) const REMIND_MINUTES_RANGE: std::ops::RangeInclusive<u64> = 1..=120;

/// 屏蔽时段（HH:MM，无日期；start > end 表示跨天）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Type)]
pub struct QuietPeriod {
    pub start: String,
    pub end: String,
}

/// 久坐提醒配置（持久化到 store）。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SedentaryConfig {
    /// 总开关。
    pub enabled: bool,
    /// 间隔时长（分钟）。
    pub remind_minutes: u64,
    /// 闲置重置阈值（分钟）。
    pub idle_reset_minutes: u64,
    /// 提醒文案。
    pub message: String,
    /// 视频播放开关（弹窗先播视频；关闭则直接显示红色界面）。默认开启；
    /// `default` 兜底旧 store 配置（升级前无此字段，反序列化不报错）。
    #[serde(default = "default_video_enabled")]
    pub video_enabled: bool,
    /// 屏蔽时段列表（空 = 不屏蔽）。`default` 兜底旧 store 配置。
    #[serde(default)]
    pub quiet_periods: Vec<QuietPeriod>,
}

/// 默认配置（读写失败时的兜底）。
pub(super) fn default_config() -> SedentaryConfig {
    SedentaryConfig {
        enabled: DEFAULT_ENABLED,
        remind_minutes: DEFAULT_REMIND_MINUTES,
        idle_reset_minutes: DEFAULT_IDLE_RESET_MINUTES,
        message: DEFAULT_MESSAGE.to_string(),
        video_enabled: DEFAULT_VIDEO_ENABLED,
        quiet_periods: Vec::new(),
    }
}

/// `video_enabled` 的 serde 兜底默认值（旧 store 配置缺少该字段时使用）。
fn default_video_enabled() -> bool {
    DEFAULT_VIDEO_ENABLED
}

/// 从 store 读取配置（未写入时返回默认值）。
pub(super) fn read_config<R: Runtime>(app: &AppHandle<R>) -> Result<SedentaryConfig, String> {
    let store = app
        .store(SEDENTARY_STORE_FILE)
        .map_err(|e| format!("打开久坐提醒 store 失败：{e}"))?;
    match store.get(SEDENTARY_STORE_KEY) {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("解析久坐提醒配置失败：{e}")),
        None => Ok(default_config()),
    }
}

/// 写入配置到 store（调用方须持有 store_lock）。
pub(super) fn write_config<R: Runtime>(
    app: &AppHandle<R>,
    config: &SedentaryConfig,
) -> Result<(), String> {
    let store = app
        .store(SEDENTARY_STORE_FILE)
        .map_err(|e| format!("打开久坐提醒 store 失败：{e}"))?;
    store.set(
        SEDENTARY_STORE_KEY,
        serde_json::to_value(config).map_err(|e| format!("序列化久坐提醒配置失败：{e}"))?,
    );
    store
        .save()
        .map_err(|e| format!("保存久坐提醒配置失败：{e}"))
}

/// 解析 "HH:MM"（容错接受 "HH:MM:SS"）为当日分钟数（0-1439）。
///
/// WebView2 的 `<input type="time">` 允许手动输入带秒的 "HH:MM:SS"，value 即返回
/// 三段；秒段不影响分钟精度，仅校验是两位 ASCII 数字后忽略其值（不做范围校验）。
/// 小时/分钟段仍严格校验：两位 ASCII 数字 + 范围（hour < 24, minute < 60）。
/// 段数不是 2 或 3、或格式非法（长度、字符、范围）返回 None。
fn parse_time(s: &str) -> Option<u32> {
    let parts: Vec<&str> = s.split(':').collect();
    let (hour, minute, second) = match parts.as_slice() {
        [hour, minute] => (*hour, *minute, None),
        [hour, minute, second] => (*hour, *minute, Some(*second)),
        _ => return None,
    };
    // 严格两位 ASCII 数字：Rust 无符号 parse 会接受 "+5" 这类带符号变体，须显式排除。
    if hour.len() != 2
        || minute.len() != 2
        || !hour.bytes().all(|b| b.is_ascii_digit())
        || !minute.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    // 秒段容错：仅校验是两位 ASCII 数字（秒值不影响分钟精度，不做范围校验）。
    if let Some(second) = second {
        if second.len() != 2 || !second.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
    }
    let hour: u32 = hour.parse().ok()?;
    let minute: u32 = minute.parse().ok()?;
    if hour >= 24 || minute >= 60 {
        return None;
    }
    Some(hour * 60 + minute)
}

/// 校验屏蔽时段列表：格式合法（`HH:MM`）、start != end、两两不重叠。
///
/// 重叠规则：每个时段展开为半开分钟区间集合——同天（start < end）为
/// `[start, end)`；跨天（start > end）覆盖两段：`[start, 1440) ∪ [0, end)`
/// （开始到午夜、午夜到结束）。任意两个时段存在区间相交即重叠。注意同天时段
/// 可能落在跨天时段的「午夜后尾巴」内（如 06:00-09:00 ⊂ 18:00-09:00 的
/// 00:00-09:00 段），也必然被检出。
pub(super) fn validate_quiet_periods(periods: &[QuietPeriod]) -> Result<(), String> {
    let intervals: Vec<Vec<(u32, u32)>> = periods
        .iter()
        .map(|p| {
            let start = parse_time(&p.start)
                .ok_or_else(|| format!("屏蔽时段开始时间格式非法：{}", p.start))?;
            let end = parse_time(&p.end)
                .ok_or_else(|| format!("屏蔽时段结束时间格式非法：{}", p.end))?;
            if start == end {
                return Err("屏蔽时段开始与结束时间不能相同".to_string());
            }
            Ok(if start < end {
                vec![(start, end)]
            } else {
                vec![(start, 1440), (0, end)]
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    for i in 0..intervals.len() {
        for j in (i + 1)..intervals.len() {
            for (a_start, a_end) in &intervals[i] {
                for (b_start, b_end) in &intervals[j] {
                    if a_start < b_end && b_start < a_end {
                        return Err("屏蔽时段存在重叠".to_string());
                    }
                }
            }
        }
    }
    Ok(())
}

/// 当前是否处于屏蔽时段。命中返回 Some(剩余秒数)，未命中返回 None。
///
/// `now_minutes` 为当日已过分钟数（0-1439）。同天（start < end）：
/// `start <= now < end`，剩余 `end - now`；跨天（start > end）：
/// `now >= start || now < end`，剩余 `(end + 1440 - now) % 1440`。
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn quiet_period_remaining_seconds(
    periods: &[QuietPeriod],
    now_minutes: u32,
) -> Option<u64> {
    periods.iter().find_map(|p| {
        let start = parse_time(&p.start)?;
        let end = parse_time(&p.end)?;
        if start < end {
            // 同天：start <= now < end。
            if now_minutes >= start && now_minutes < end {
                Some(((end - now_minutes) * 60) as u64)
            } else {
                None
            }
        } else if start > end {
            // 跨天：now >= start || now < end（start == end 在配置校验层已拒绝）。
            if now_minutes >= start || now_minutes < end {
                Some((((end + 1440 - now_minutes) % 1440) * 60) as u64)
            } else {
                None
            }
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_matches_prd() {
        let config = default_config();
        assert!(config.enabled);
        assert_eq!(config.remind_minutes, 45);
        assert_eq!(config.idle_reset_minutes, 5);
        assert_eq!(config.message, "起来活动一下");
        assert!(config.video_enabled);
        assert!(config.quiet_periods.is_empty());
    }

    #[test]
    fn config_video_enabled_serializes_as_camel_case() {
        let value = serde_json::to_value(default_config()).unwrap();
        assert_eq!(
            value.get("videoEnabled"),
            Some(&serde_json::Value::Bool(true))
        );
    }

    #[test]
    fn config_video_enabled_defaults_true_when_missing() {
        // 旧 store 配置（无 videoEnabled 字段）：反序列化兜底为开启，不报错。
        let json = serde_json::json!({
            "enabled": true,
            "remindMinutes": 45,
            "idleResetMinutes": 5,
            "message": "起来活动一下"
        });
        let config: SedentaryConfig = serde_json::from_value(json).unwrap();
        assert!(config.video_enabled);
        // 旧配置无 quietPeriods 字段：兜底为空列表（不屏蔽）。
        assert!(config.quiet_periods.is_empty());
    }

    #[test]
    fn quiet_parse_time_valid() {
        assert_eq!(parse_time("00:00"), Some(0));
        assert_eq!(parse_time("09:00"), Some(540));
        assert_eq!(parse_time("23:59"), Some(1439));
    }

    #[test]
    fn quiet_parse_time_invalid() {
        assert_eq!(parse_time("25:00"), None);
        assert_eq!(parse_time("9:00"), None);
        assert_eq!(parse_time("09:60"), None);
        assert_eq!(parse_time("09:0"), None);
        assert_eq!(parse_time("0900"), None);
        assert_eq!(parse_time(""), None);
    }

    #[test]
    fn quiet_parse_time_rejects_non_digit_variants() {
        // Rust 无符号 parse 接受前导 '+'，必须按 ASCII 数字显式校验（严格 HH:MM）。
        assert_eq!(parse_time("+5:00"), None);
        assert_eq!(parse_time("0a:00"), None);
        assert_eq!(parse_time("09:0 "), None);
        assert_eq!(parse_time(" 9:00"), None);
    }

    #[test]
    fn quiet_parse_time_accepts_seconds() {
        // WebView2 的 type="time" 允许手动输入带秒的 "HH:MM:SS"，秒段容错忽略
        // （不影响分钟精度，仅校验两位 ASCII 数字，不做范围校验）。
        assert_eq!(parse_time("18:36:37"), Some(1116));
        assert_eq!(parse_time("09:00:00"), Some(540));
    }

    #[test]
    fn quiet_parse_time_rejects_more_than_three_segments() {
        // 段数不是 2 或 3 一律拒绝（如 "18:36:37:12"）。
        assert_eq!(parse_time("18:36:37:12"), None);
    }

    #[test]
    fn quiet_same_day_period_boundaries() {
        let periods = vec![QuietPeriod {
            start: "09:00".to_string(),
            end: "18:00".to_string(),
        }];
        // start 边界：恰好到开始时刻即命中（半开 [start, end)）。
        assert_eq!(
            quiet_period_remaining_seconds(&periods, 9 * 60),
            Some(9 * 3600)
        );
        // 结束前一分钟仍命中，剩余 1 分钟。
        assert_eq!(
            quiet_period_remaining_seconds(&periods, 17 * 60 + 59),
            Some(60)
        );
        // end 边界：恰好到结束时刻未命中。
        assert_eq!(quiet_period_remaining_seconds(&periods, 18 * 60), None);
    }

    #[test]
    fn quiet_cross_day_period_boundaries() {
        let periods = vec![QuietPeriod {
            start: "18:00".to_string(),
            end: "09:00".to_string(),
        }];
        // start 边界：恰好到开始时刻即命中，剩余 15 小时。
        assert_eq!(
            quiet_period_remaining_seconds(&periods, 18 * 60),
            Some(15 * 3600)
        );
        // end 边界：恰好到结束时刻未命中。
        assert_eq!(quiet_period_remaining_seconds(&periods, 9 * 60), None);
        // 23:59 命中，剩余 9 小时 1 分。
        assert_eq!(
            quiet_period_remaining_seconds(&periods, 23 * 60 + 59),
            Some(9 * 3600 + 60)
        );
    }

    #[test]
    fn quiet_same_day_period_remaining() {
        let periods = vec![QuietPeriod {
            start: "09:00".to_string(),
            end: "18:00".to_string(),
        }];
        // 10:00 命中，剩余 8 小时。
        assert_eq!(
            quiet_period_remaining_seconds(&periods, 10 * 60),
            Some(8 * 3600)
        );
        // 8:00 未命中。
        assert_eq!(quiet_period_remaining_seconds(&periods, 8 * 60), None);
        // 18:00 恰好到结束时刻，未命中。
        assert_eq!(quiet_period_remaining_seconds(&periods, 18 * 60), None);
    }

    #[test]
    fn quiet_cross_day_period_remaining() {
        let periods = vec![QuietPeriod {
            start: "18:00".to_string(),
            end: "09:00".to_string(),
        }];
        // 20:00 命中，剩余 13 小时。
        assert_eq!(
            quiet_period_remaining_seconds(&periods, 20 * 60),
            Some(13 * 3600)
        );
        // 2:00 命中，剩余 7 小时。
        assert_eq!(
            quiet_period_remaining_seconds(&periods, 2 * 60),
            Some(7 * 3600)
        );
        // 12:00 未命中。
        assert_eq!(quiet_period_remaining_seconds(&periods, 12 * 60), None);
    }

    #[test]
    fn quiet_validate_rejects_same_start_end() {
        let periods = vec![QuietPeriod {
            start: "09:00".to_string(),
            end: "09:00".to_string(),
        }];
        assert!(validate_quiet_periods(&periods).is_err());
    }

    #[test]
    fn quiet_validate_rejects_overlap_same_day() {
        let periods = vec![
            QuietPeriod {
                start: "09:00".to_string(),
                end: "18:00".to_string(),
            },
            QuietPeriod {
                start: "12:00".to_string(),
                end: "20:00".to_string(),
            },
        ];
        assert!(validate_quiet_periods(&periods).is_err());
    }

    #[test]
    fn quiet_validate_rejects_overlap_cross_day() {
        let periods = vec![
            QuietPeriod {
                start: "18:00".to_string(),
                end: "09:00".to_string(),
            },
            QuietPeriod {
                start: "19:00".to_string(),
                end: "08:00".to_string(),
            },
        ];
        assert!(validate_quiet_periods(&periods).is_err());
    }

    #[test]
    fn quiet_validate_allows_same_day_plus_cross_day() {
        // 同天时段与跨天时段首尾相接（09:00-18:00 / 18:00-09:00）不重叠。
        let periods = vec![
            QuietPeriod {
                start: "09:00".to_string(),
                end: "18:00".to_string(),
            },
            QuietPeriod {
                start: "18:00".to_string(),
                end: "09:00".to_string(),
            },
        ];
        assert!(validate_quiet_periods(&periods).is_ok());
    }

    #[test]
    fn quiet_validate_rejects_overlap_tail_of_cross_day() {
        // 同天时段可能落在跨天时段的「午夜后尾巴」内（06:00-09:00 ⊂ 18:00-09:00
        // 的 00:00-09:00 段），两时段在 06:00-09:00 同时生效，必须判定为重叠。
        let periods = vec![
            QuietPeriod {
                start: "06:00".to_string(),
                end: "09:00".to_string(),
            },
            QuietPeriod {
                start: "18:00".to_string(),
                end: "09:00".to_string(),
            },
        ];
        assert!(validate_quiet_periods(&periods).is_err());
    }

    #[test]
    fn quiet_validate_rejects_overlap_head_of_cross_day() {
        // 同天时段覆盖跨天时段的「开始段」（21:00-23:00 ⊂ 20:00-08:00 的
        // 20:00-24:00 段），同样判定为重叠。
        let periods = vec![
            QuietPeriod {
                start: "21:00".to_string(),
                end: "23:00".to_string(),
            },
            QuietPeriod {
                start: "20:00".to_string(),
                end: "08:00".to_string(),
            },
        ];
        assert!(validate_quiet_periods(&periods).is_err());
    }

    #[test]
    fn quiet_validate_rejects_bad_format() {
        let periods = vec![QuietPeriod {
            start: "09:00".to_string(),
            end: "18".to_string(),
        }];
        assert!(validate_quiet_periods(&periods).is_err());
    }
}
