export const baseStyles = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Google Sans", "Open Sans", Roboto, Helvetica, Arial, sans-serif; color: #202124; background: #fff; }
  .cc-app { padding: 20px 28px 40px; max-width: 1280px; }
  .cc-loading { padding: 40px; color: #5f6368; }
  .cc-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .cc-header h1 { font-size: 20px; font-weight: 500; margin: 0; }
  .cc-header .cc-meta { color: #5f6368; font-size: 12px; }
  .cc-tabs { display: flex; gap: 4px; border-bottom: 1px solid #dadce0; margin-bottom: 16px; }
  .cc-tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 10px 14px; font-size: 14px; cursor: pointer; color: #5f6368; }
  .cc-tab.active { color: #1a73e8; border-bottom-color: #1a73e8; font-weight: 500; }
  .cc-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  .cc-toolbar .cc-spacer { flex: 1; }
  .cc-btn { border: 1px solid #dadce0; background: #fff; color: #1a73e8; border-radius: 4px; padding: 6px 12px; font-size: 13px; cursor: pointer; white-space: nowrap; }
  .cc-btn:hover { background: #f1f3f4; }
  .cc-btn:disabled { color: #9aa0a6; cursor: default; background: #fff; }
  .cc-btn.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  .cc-btn.primary:hover { background: #1765cc; }
  .cc-btn.danger { color: #c5221f; }
  .cc-btn.danger.primary { background: #c5221f; border-color: #c5221f; color: #fff; }
  .cc-btn.small { padding: 3px 8px; font-size: 12px; }
  .cc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .cc-table th { text-align: left; font-weight: 500; color: #5f6368; border-bottom: 1px solid #dadce0; padding: 8px 10px; white-space: nowrap; }
  .cc-table td { border-bottom: 1px solid #f1f3f4; padding: 8px 10px; vertical-align: middle; }
  .cc-table td.num, .cc-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .cc-table tr.over td { background: #fce8e6; }
  .cc-table tr.warn td { background: #fef7e0; }
  .cc-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
  .cc-badge.ok { background: #e6f4ea; color: #137333; }
  .cc-badge.stop { background: #fce8e6; color: #c5221f; }
  .cc-badge.none { background: #f1f3f4; color: #5f6368; }
  .cc-badge.warn { background: #fef7e0; color: #b06000; }
  .cc-bar { height: 6px; background: #f1f3f4; border-radius: 3px; overflow: hidden; min-width: 90px; }
  .cc-bar > div { height: 100%; background: #1a73e8; }
  .cc-bar.over > div { background: #c5221f; }
  .cc-bar.warn > div { background: #f9ab00; }
  .cc-input { border: 1px solid #dadce0; border-radius: 4px; padding: 5px 8px; font-size: 13px; min-width: 90px; }
  .cc-input.wide { min-width: 200px; }
  .cc-banner { padding: 10px 14px; border-radius: 4px; margin-bottom: 12px; font-size: 13px; }
  .cc-banner.error { background: #fce8e6; color: #c5221f; }
  .cc-banner.info { background: #e8f0fe; color: #174ea6; }
  .cc-banner.warn { background: #fef7e0; color: #b06000; }
  .cc-muted { color: #5f6368; font-size: 12px; }
  .cc-inline { display: inline-flex; gap: 6px; align-items: center; }
  .cc-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 12px; background: #f8f9fa; border-radius: 6px; margin-bottom: 12px; }
  .cc-empty { padding: 24px; color: #5f6368; text-align: center; }
  select.cc-input { min-width: auto; }
`
