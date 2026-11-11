use super::*;

fn alert_test_pool() -> Pool {
    let pool = r2d2::Pool::builder()
        .max_size(1)
        .build(r2d2_sqlite::SqliteConnectionManager::memory())
        .unwrap();
    pool.get()
        .unwrap()
        .execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        .unwrap();
    pool
}

fn enabled_window_config() -> AlertConfig {
    AlertConfig {
        window_enabled: true,
        window_remaining_min: 100,
        ..AlertConfig::default()
    }
}

#[test]
fn editing_window_minutes_rearms_all_providers_without_resetting_peak_alerts() {
    let pool = alert_test_pool();
    let cfg = enabled_window_config();
    set_alert_config(&pool, &cfg).unwrap();
    for provider in ["first", "second"] {
        kv::set(&pool, &fired_key("win", provider), "win:123").unwrap();
    }
    kv::set(&pool, &fired_key("peak", "first"), "peak:2026-11-11").unwrap();
    kv::set(&pool, &fired_key("peakuse", "first"), "peakuse:2026-11-11").unwrap();

    set_alert_config(
        &pool,
        &AlertConfig {
            window_remaining_min: 95,
            ..cfg
        },
    )
    .unwrap();

    assert_eq!(alert_config(&pool).window_remaining_min, 95);
    for provider in ["first", "second"] {
        assert_eq!(kv::get(&pool, &fired_key("win", provider)).unwrap(), None);
    }
    assert_eq!(
        kv::get(&pool, &fired_key("peak", "first"))
            .unwrap()
            .as_deref(),
        Some("peak:2026-11-11")
    );
    assert_eq!(
        kv::get(&pool, &fired_key("peakuse", "first"))
            .unwrap()
            .as_deref(),
        Some("peakuse:2026-11-11")
    );
}

#[test]
fn editing_remaining_quota_or_reenabling_rearms_window_alerts() {
    let pool = alert_test_pool();
    let cfg = enabled_window_config();
    set_alert_config(&pool, &cfg).unwrap();
    let key = fired_key("win", "provider");
    kv::set(&pool, &key, "win:123").unwrap();

    let changed = AlertConfig {
        window_keep_pct: 60.0,
        ..cfg
    };
    set_alert_config(&pool, &changed).unwrap();
    assert_eq!(kv::get(&pool, &key).unwrap(), None);

    set_alert_config(
        &pool,
        &AlertConfig {
            window_enabled: false,
            ..changed
        },
    )
    .unwrap();
    kv::set(&pool, &key, "win:123").unwrap();
    set_alert_config(&pool, &changed).unwrap();
    assert_eq!(kv::get(&pool, &key).unwrap(), None);
}

#[test]
fn unchanged_and_peak_only_saves_preserve_window_alerts() {
    let pool = alert_test_pool();
    let cfg = enabled_window_config();
    set_alert_config(&pool, &cfg).unwrap();
    let key = fired_key("win", "provider");
    kv::set(&pool, &key, "win:123").unwrap();

    set_alert_config(&pool, &cfg).unwrap();
    set_alert_config(
        &pool,
        &AlertConfig {
            peak_enabled: false,
            peak_lead_min: 30,
            ..cfg
        },
    )
    .unwrap();
    assert_eq!(kv::get(&pool, &key).unwrap().as_deref(), Some("win:123"));
}

#[test]
fn identical_effective_clamped_values_preserve_window_alerts() {
    let pool = alert_test_pool();
    let cfg = AlertConfig {
        window_remaining_min: 180,
        window_keep_pct: 95.0,
        ..enabled_window_config()
    };
    set_alert_config(&pool, &cfg).unwrap();
    let key = fired_key("win", "provider");
    kv::set(&pool, &key, "win:123").unwrap();

    set_alert_config(
        &pool,
        &AlertConfig {
            window_remaining_min: 999,
            window_keep_pct: 100.0,
            ..cfg
        },
    )
    .unwrap();
    assert_eq!(kv::get(&pool, &key).unwrap().as_deref(), Some("win:123"));
}

#[test]
fn failed_rearm_rolls_back_config_save() {
    let pool = alert_test_pool();
    let cfg = enabled_window_config();
    set_alert_config(&pool, &cfg).unwrap();
    let key = fired_key("win", "provider");
    kv::set(&pool, &key, "win:123").unwrap();
    pool.get()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER prevent_alert_reset BEFORE DELETE ON settings
         WHEN OLD.key GLOB 'billing.alert.fired.win.*'
         BEGIN SELECT RAISE(ABORT, 'rearm failed'); END",
        )
        .unwrap();

    assert!(set_alert_config(
        &pool,
        &AlertConfig {
            window_remaining_min: 95,
            ..cfg
        }
    )
    .is_err());
    assert_eq!(alert_config(&pool).window_remaining_min, 100);
    assert_eq!(kv::get(&pool, &key).unwrap().as_deref(), Some("win:123"));
}

#[test]
fn edited_time_waits_for_the_new_threshold_then_notifies_once() {
    let pool = alert_test_pool();
    let cfg = enabled_window_config();
    let now = 1_700_000_000_000;
    set_alert_config(&pool, &cfg).unwrap();
    save_window(
        &pool,
        "provider",
        &WindowState {
            used_pct: 10.0,
            reset_at_ms: now + 98 * 60_000,
            ..Default::default()
        },
    );
    let mut sent = 0;
    assert!(maybe_window_alert_with(&pool, "provider", now, |_| {
        sent += 1;
        Ok(())
    })
    .unwrap());

    assert!(set_alert_config(
        &pool,
        &AlertConfig {
            window_remaining_min: 95,
            ..cfg
        }
    )
    .unwrap());
    assert!(!maybe_window_alert_with(&pool, "provider", now, |_| {
        sent += 1;
        Ok(())
    })
    .unwrap());
    assert!(
        !maybe_window_alert_with(&pool, "provider", now + 2 * 60_000, |_| {
            sent += 1;
            Ok(())
        })
        .unwrap()
    );
    assert_eq!(sent, 1);

    assert!(
        maybe_window_alert_with(&pool, "provider", now + 3 * 60_000, |_| {
            sent += 1;
            Ok(())
        })
        .unwrap()
    );
    assert!(
        !maybe_window_alert_with(&pool, "provider", now + 4 * 60_000, |_| {
            sent += 1;
            Ok(())
        })
        .unwrap()
    );
    assert_eq!(sent, 2);
}

#[test]
fn edited_time_already_met_notifies_again_in_the_same_window() {
    let pool = alert_test_pool();
    let cfg = enabled_window_config();
    let now = 1_700_000_000_000;
    set_alert_config(&pool, &cfg).unwrap();
    save_window(
        &pool,
        "provider",
        &WindowState {
            used_pct: 11.0,
            reset_at_ms: now + 94 * 60_000,
            ..Default::default()
        },
    );
    let mut sent = 0;
    assert!(maybe_window_alert_with(&pool, "provider", now, |_| {
        sent += 1;
        Ok(())
    })
    .unwrap());

    let changed = AlertConfig {
        window_remaining_min: 95,
        ..cfg
    };
    assert!(set_alert_config(&pool, &changed).unwrap());
    assert!(maybe_window_alert_with(&pool, "provider", now, |_| {
        sent += 1;
        Ok(())
    })
    .unwrap());
    assert!(!set_alert_config(&pool, &changed).unwrap());
    assert!(!maybe_window_alert_with(&pool, "provider", now, |_| {
        sent += 1;
        Ok(())
    })
    .unwrap());
    assert_eq!(sent, 2);

    // 回到以前用过的 100 分钟也是一次真实修改,应该允许再提醒。
    assert!(set_alert_config(&pool, &cfg).unwrap());
    assert!(maybe_window_alert_with(&pool, "provider", now, |_| {
        sent += 1;
        Ok(())
    })
    .unwrap());
    assert_eq!(sent, 3);
}

#[test]
fn edited_quota_requires_the_new_percentage_to_be_met() {
    let pool = alert_test_pool();
    let cfg = AlertConfig {
        window_keep_pct: 30.0,
        ..enabled_window_config()
    };
    let now = 1_700_000_000_000;
    set_alert_config(&pool, &cfg).unwrap();
    save_window(
        &pool,
        "provider",
        &WindowState {
            used_pct: 60.0,
            reset_at_ms: now + 94 * 60_000,
            ..Default::default()
        },
    );
    assert!(maybe_window_alert_with(&pool, "provider", now, |_| Ok(())).unwrap());

    set_alert_config(
        &pool,
        &AlertConfig {
            window_keep_pct: 50.0,
            ..cfg
        },
    )
    .unwrap();
    assert!(
        !maybe_window_alert_with(&pool, "provider", now, |_| panic!("40% left is below 50%"))
            .unwrap()
    );
    set_alert_config(
        &pool,
        &AlertConfig {
            window_keep_pct: 35.0,
            ..cfg
        },
    )
    .unwrap();
    assert!(maybe_window_alert_with(&pool, "provider", now, |_| Ok(())).unwrap());
}

#[test]
fn disabled_alert_waits_until_reenabled() {
    let pool = alert_test_pool();
    let cfg = enabled_window_config();
    let now = 1_700_000_000_000;
    set_alert_config(&pool, &cfg).unwrap();
    save_window(
        &pool,
        "provider",
        &WindowState {
            reset_at_ms: now + 94 * 60_000,
            ..Default::default()
        },
    );
    assert!(maybe_window_alert_with(&pool, "provider", now, |_| Ok(())).unwrap());
    set_alert_config(
        &pool,
        &AlertConfig {
            window_enabled: false,
            ..cfg
        },
    )
    .unwrap();
    assert!(!maybe_window_alert_with(&pool, "provider", now, |_| panic!("disabled")).unwrap());
    set_alert_config(&pool, &cfg).unwrap();
    assert!(maybe_window_alert_with(&pool, "provider", now, |_| Ok(())).unwrap());
}

#[test]
fn failed_notification_submission_can_retry() {
    let pool = alert_test_pool();
    let now = 1_700_000_000_000;
    set_alert_config(&pool, &enabled_window_config()).unwrap();
    save_window(
        &pool,
        "provider",
        &WindowState {
            reset_at_ms: now + 94 * 60_000,
            ..Default::default()
        },
    );
    assert!(
        maybe_window_alert_with(&pool, "provider", now, |_| Err(anyhow!(
            "notification rejected"
        )))
        .is_err()
    );
    assert_eq!(kv::get(&pool, &fired_key("win", "provider")).unwrap(), None);
    assert!(maybe_window_alert_with(&pool, "provider", now, |_| Ok(())).unwrap());
    assert!(!maybe_window_alert_with(&pool, "provider", now, |_| panic!("already sent")).unwrap());
}

#[test]
fn providers_and_new_windows_have_independent_reminders() {
    let pool = alert_test_pool();
    let now = 1_700_000_000_000;
    set_alert_config(&pool, &enabled_window_config()).unwrap();
    for provider in ["first", "second"] {
        save_window(
            &pool,
            provider,
            &WindowState {
                reset_at_ms: now + 94 * 60_000,
                ..Default::default()
            },
        );
        assert!(maybe_window_alert_with(&pool, provider, now, |_| Ok(())).unwrap());
    }
    assert!(!maybe_window_alert_with(&pool, "first", now, |_| panic!("already sent")).unwrap());
    save_window(
        &pool,
        "first",
        &WindowState {
            reset_at_ms: now + 99 * 60_000,
            ..Default::default()
        },
    );
    assert!(maybe_window_alert_with(&pool, "first", now, |_| Ok(())).unwrap());
    assert!(
        !maybe_window_alert_with(&pool, "second", now, |_| panic!("unchanged window")).unwrap()
    );
}

#[test]
fn missing_or_invalid_window_does_not_consume_a_reminder() {
    let pool = alert_test_pool();
    let now = 1_700_000_000_000;
    set_alert_config(&pool, &enabled_window_config()).unwrap();
    assert!(!maybe_window_alert_with(&pool, "provider", now, |_| panic!("no window")).unwrap());
    kv::set(&pool, &window_key("provider"), "invalid json").unwrap();
    assert!(
        !maybe_window_alert_with(&pool, "provider", now, |_| panic!("invalid window")).unwrap()
    );
    assert_eq!(kv::get(&pool, &fired_key("win", "provider")).unwrap(), None);
}

#[test]
fn concurrent_window_checks_submit_only_one_notification() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    };
    let dir = std::env::temp_dir().join(format!("keyway-alert-{}", uuid::Uuid::new_v4()));
    let pool = crate::db::init_pool(dir.join("test.db"), &"ab".repeat(32)).unwrap();
    let now = 1_700_000_000_000;
    set_alert_config(&pool, &enabled_window_config()).unwrap();
    save_window(
        &pool,
        "provider",
        &WindowState {
            reset_at_ms: now + 94 * 60_000,
            ..Default::default()
        },
    );
    let sent = Arc::new(AtomicUsize::new(0));
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let pool = pool.clone();
            let sent = sent.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                maybe_window_alert_with(&pool, "provider", now, |_| {
                    sent.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    Ok(())
                })
                .unwrap()
            })
        })
        .collect();
    let submissions: usize = handles
        .into_iter()
        .map(|handle| usize::from(handle.join().unwrap()))
        .sum();
    assert_eq!(submissions, 1);
    assert_eq!(sent.load(Ordering::SeqCst), 1);
    drop(pool);
    std::fs::remove_dir_all(dir).unwrap();
}
