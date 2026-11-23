import { PREFIX } from "./prefix";

/**
 * THE ADVANCED VIEW'S STYLESHEET (sgiant-platform#702).
 *
 * The owner-approved picture is examples/advanced-view-prototype.html: the
 * conversation list on the left, the chat in the middle with no bar over it,
 * the page on the right at a fixed width. Every colour, radius, font, size
 * and duration here is a --aiw-* custom property, so a host repaints the
 * whole view with the same tokens it uses for the small window; the dark
 * scheme comes from the same token block as the rest of the sheet.
 *
 * MOTION. Nothing here transitions a width: the list folds and the page
 * closes at once, and what moves is a transform or an opacity (the page
 * slides in, the phone's list slides from the left, a ring marks a page the
 * assistant opened). Reduced motion is handled where the rest of the sheet
 * handles it, in styles.ts: each keyframe below is redefined there, and the
 * two transitions are switched off.
 *
 * Interpolated into the main sheet, after the phone-sheet media block, so a
 * rule here wins over the small window's phone layout.
 */
export function advancedCss(): string {
  const adv = `.${PREFIX}-advanced`;
  const phone = `.${PREFIX}-panel[data-aiw-mode="phone"]`;
  const laptop = `.${PREFIX}-panel[data-aiw-mode="laptop"]`;
  return `
@keyframes ${PREFIX}-panein{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
@keyframes ${PREFIX}-sidein{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
@keyframes ${PREFIX}-sheetin{from{transform:translateY(100%)}to{transform:none}}
@keyframes ${PREFIX}-ring{0%{opacity:.9}100%{opacity:0}}
@keyframes ${PREFIX}-shim{from{background-position:200% 0}to{background-position:-200% 0}}
.${PREFIX}-ctop,.${PREFIX}-turnline{display:none}
${adv}{flex-direction:row;align-items:stretch;background:var(--aiw-surface);font-family:var(--aiw-font-family)}
${adv} .${PREFIX}-header{display:none}
${adv} .${PREFIX}-chatcol{flex:1 1 0;min-width:0;position:relative;background:var(--aiw-surface)}
${adv} .${PREFIX}-log{background:var(--aiw-surface);padding:8px max(18px,calc((100% - var(--aiw-chat-max)) / 2)) 12px;gap:14px}
${adv} :is(.${PREFIX}-form,.${PREFIX}-suggestions,.${PREFIX}-artifacts,.${PREFIX}-attbar,.${PREFIX}-status,.${PREFIX}-meter,.${PREFIX}-turnline){box-sizing:border-box;width:100%;max-width:calc(var(--aiw-chat-max) + 36px);margin-left:auto;margin-right:auto;background:transparent}
${adv} .${PREFIX}-form{border-top:0;padding:8px 18px 14px}
${adv} .${PREFIX}-input{border-radius:var(--aiw-radius-3xl);padding:11px 16px;font-size:var(--aiw-font-lg)}
${adv} .${PREFIX}-msg{font-size:var(--aiw-font-lg);line-height:1.55;max-width:80%}
${adv} .${PREFIX}-msg.${PREFIX}-user{background:var(--aiw-bubble);color:var(--aiw-text);border-radius:var(--aiw-radius-3xl);padding:9px 15px}
${adv} .${PREFIX}-msg.${PREFIX}-assistant{background:transparent;border:0;padding:0;max-width:100%;font-family:var(--aiw-font-answer);font-size:var(--aiw-font-xl);line-height:1.65}
${adv} .${PREFIX}-ib{min-width:var(--aiw-hit);height:var(--aiw-hit);padding:0 8px;border:0;border-radius:var(--aiw-radius-md);background:transparent;color:inherit;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;font:inherit;font-size:var(--aiw-font-sm);font-weight:600;flex:0 0 auto;transition:background-color var(--aiw-dur-out) var(--aiw-ease)}
${adv} .${PREFIX}-ib:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
${adv} .${PREFIX}-grow{flex:1 1 auto}
.${PREFIX}-panel[data-aiw-mode="phone"]{--aiw-hit:44px}
@media (pointer:coarse){${adv}{--aiw-hit:44px}}
/* The row over the chat: the conversation's title, the More menu, and the
   page's door when the page is closed. No bar, no colour of its own. */
${adv} .${PREFIX}-ctop{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-height:52px;padding:0 10px 0 18px;color:var(--aiw-text-2)}
${adv} .${PREFIX}-ctop-back,${adv} .${PREFIX}-ctop-side{display:none}
${phone} .${PREFIX}-ctop{padding-left:6px}
${phone} .${PREFIX}-ctop-back,${phone} .${PREFIX}-ctop-side{display:inline-flex}
${adv} .${PREFIX}-ctop-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--aiw-font-md);font-weight:600;color:var(--aiw-text-2)}
${adv} .${PREFIX}-ctop .${PREFIX}-icon{width:var(--aiw-hit);height:var(--aiw-hit);background:transparent;color:var(--aiw-text-2)}
${adv} .${PREFIX}-ctop .${PREFIX}-icon:hover{background:color-mix(in srgb,var(--aiw-text) 8%,transparent)}
${adv} .${PREFIX}-ctop .${PREFIX}-icon-on{background:color-mix(in srgb,var(--aiw-text) 12%,transparent);color:var(--aiw-text)}
${adv} .${PREFIX}-ctop-app{border:1px solid var(--aiw-border-strong);background:var(--aiw-surface-raised);color:var(--aiw-text)}
${adv} .${PREFIX}-ctop-app[hidden]{display:none}
${phone} .${PREFIX}-ctop-app-t{display:none}
/* The status line: what the answer is doing before its words arrive. */
${adv} .${PREFIX}-turnline{display:flex;align-items:center;gap:8px;padding:2px 18px 4px;font-size:var(--aiw-font-sm);font-weight:500;color:var(--aiw-muted)}
${adv} .${PREFIX}-turnline[hidden]{display:none}
${adv} .${PREFIX}-turnline-t{background:linear-gradient(90deg,var(--aiw-muted) 30%,var(--aiw-text) 50%,var(--aiw-muted) 70%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:${PREFIX}-shim calc(var(--aiw-dur-slow) * 2.4) linear infinite;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${adv} .${PREFIX}-typing{display:none}
/* The step running now is said once, on the status line; the log keeps the
   finished steps, as a record. */
${adv} .${PREFIX}-activity:not(.${PREFIX}-activity-done){display:none}
${adv} .${PREFIX}-form-row{min-height:var(--aiw-hit)}
${adv} .${PREFIX}-send{min-width:var(--aiw-hit);min-height:var(--aiw-hit)}
.${PREFIX}-send.${PREFIX}-send-stop{background:var(--aiw-text);color:var(--aiw-surface)}
.${PREFIX}-stopped{align-self:flex-start;font-size:var(--aiw-font-xs);color:var(--aiw-muted)}
/* The new-chat screen: the greeting large and centred, the box under it,
   the suggestions under the box. */
${adv}.${PREFIX}-blank .${PREFIX}-log{flex:1 1 0;justify-content:flex-end;overflow:hidden}
${adv}.${PREFIX}-blank .${PREFIX}-msg.${PREFIX}-assistant{align-self:center;text-align:center;font-size:var(--aiw-font-3xl);font-weight:500;line-height:1.25;max-width:min(100%,32ch)}
${adv}.${PREFIX}-blank .${PREFIX}-msgactions{display:none}
${adv}.${PREFIX}-blank .${PREFIX}-suggestions{order:10;flex:1 1 0;align-content:flex-start;justify-content:center;gap:8px;padding:6px 18px 0}
${adv}.${PREFIX}-blank .${PREFIX}-suggestion{min-height:calc(var(--aiw-hit) + 2px);padding:0 14px;border-color:var(--aiw-border-strong);background:var(--aiw-surface-raised);color:var(--aiw-text);font-size:var(--aiw-font-sm)}
/* ── The list on the left ── */
.${PREFIX}-side,.${PREFIX}-scrim{display:none}
${adv} .${PREFIX}-side{position:relative;display:flex;flex-direction:column;flex:0 0 var(--aiw-side-w);width:var(--aiw-side-w);min-height:0;background:var(--aiw-surface-2);border-right:1px solid var(--aiw-border);color:var(--aiw-text);z-index:4}
${adv} .${PREFIX}-side-full{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;width:100%}
${adv} .${PREFIX}-side-rail{display:none;flex-direction:column;align-items:center;gap:4px;padding:10px 0;flex:1 1 auto;min-height:0}
${adv}:not(.${PREFIX}-side-open) .${PREFIX}-side{flex-basis:var(--aiw-rail-w);width:var(--aiw-rail-w)}
${adv}:not(.${PREFIX}-side-open) .${PREFIX}-side-full{display:none}
${adv}:not(.${PREFIX}-side-open) .${PREFIX}-side-rail{display:flex}
${laptop} .${PREFIX}-side{flex-basis:var(--aiw-rail-w);width:var(--aiw-rail-w)}
${laptop} .${PREFIX}-side-rail{display:flex}
${laptop}.${PREFIX}-side-open .${PREFIX}-side-full{position:absolute;top:0;bottom:0;left:0;z-index:1;width:var(--aiw-side-w);background:var(--aiw-surface-2);border-right:1px solid var(--aiw-border);box-shadow:var(--aiw-side-shadow);animation:${PREFIX}-sidein var(--aiw-dur-in) var(--aiw-ease)}
${phone} .${PREFIX}-side{position:absolute;top:0;bottom:0;left:0;flex:none;width:min(86%,330px);transform:translateX(-102%);visibility:hidden;z-index:6;transition:transform var(--aiw-dur-in) var(--aiw-ease),visibility 0s linear var(--aiw-dur-in)}
${phone}.${PREFIX}-side-open .${PREFIX}-side{transform:none;visibility:visible;box-shadow:var(--aiw-drawer-shadow);transition:transform var(--aiw-dur-in) var(--aiw-ease),visibility 0s}
${phone} .${PREFIX}-side-rail{display:none}
${phone} .${PREFIX}-side-full{display:flex}
${phone} .${PREFIX}-scrim{display:block;position:absolute;inset:0;z-index:5;background:var(--aiw-scrim);opacity:0;pointer-events:none;transition:opacity var(--aiw-dur-out) var(--aiw-ease)}
${phone} .${PREFIX}-scrim.${PREFIX}-scrim-on{opacity:1;pointer-events:auto}
${adv} .${PREFIX}-side-top{display:flex;flex-direction:column;gap:6px;padding:10px 10px 4px}
${adv} .${PREFIX}-side-row{display:flex;align-items:center;gap:4px;min-height:40px}
${adv} .${PREFIX}-side-logobtn{min-width:0;padding:4px 6px;justify-content:flex-start;color:var(--aiw-text)}
${adv} .${PREFIX}-side-logo{display:inline-flex;align-items:center;gap:8px;min-width:0}
${adv} .${PREFIX}-side-logo img{display:block;height:26px;width:auto;max-width:150px}
${adv} .${PREFIX}-rail-logo{width:44px;height:44px;padding:0}
${adv} .${PREFIX}-rail-logo img{height:30px;max-width:40px}
${adv} .${PREFIX}-logo-dark{display:none!important}
${adv} .${PREFIX}-side-mark{display:inline-grid;place-items:center;width:26px;height:26px;flex:0 0 26px}
${adv} .${PREFIX}-side-mark svg,${adv} .${PREFIX}-side-mark img{width:26px;height:26px}
${adv} .${PREFIX}-side-name{font-size:var(--aiw-font-lg);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${adv} .${PREFIX}-side-new{display:flex;align-items:center;gap:10px;width:100%;min-height:var(--aiw-hit);padding:0 10px;border:1px solid var(--aiw-border-strong);border-radius:var(--aiw-radius-md);background:var(--aiw-surface-raised);color:var(--aiw-text);font:inherit;font-size:var(--aiw-font-sm);font-weight:600;text-align:left;cursor:pointer}
${adv} .${PREFIX}-side-search{display:flex;align-items:center;gap:8px;min-height:var(--aiw-hit);padding:0 10px;border:1px solid var(--aiw-border);border-radius:var(--aiw-radius-md);background:var(--aiw-surface-raised);color:var(--aiw-muted)}
${adv} .${PREFIX}-side-search:focus-within{border-color:var(--aiw-accent-ink);box-shadow:0 0 0 3px color-mix(in srgb,var(--aiw-accent) 22%,transparent)}
${adv} .${PREFIX}-side-q{flex:1 1 auto;min-width:0;border:0;outline:0;background:transparent;color:var(--aiw-text);font:inherit;font-size:var(--aiw-font-sm)}
${adv} .${PREFIX}-side-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 10px 10px;scrollbar-width:thin}
${adv} .${PREFIX}-side-sep{padding:14px 10px 4px;font-size:var(--aiw-font-2xs);font-weight:600;color:var(--aiw-muted)}
${adv} .${PREFIX}-side-item{display:flex;align-items:center;border-radius:var(--aiw-radius-md)}
${adv} .${PREFIX}-side-item:hover{background:color-mix(in srgb,var(--aiw-text) 5%,transparent)}
${adv} .${PREFIX}-side-link{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;min-height:var(--aiw-hit);padding:0 6px 0 10px;border:0;border-radius:var(--aiw-radius-md);background:transparent;color:var(--aiw-text-2);font:inherit;font-size:var(--aiw-font-sm);text-align:left;cursor:pointer}
${adv} .${PREFIX}-side-link[aria-current="true"]{color:var(--aiw-text);font-weight:600;background:color-mix(in srgb,var(--aiw-text) 9%,transparent)}
${adv} .${PREFIX}-side-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${adv} .${PREFIX}-side-new-dot,${adv} .${PREFIX}-rail-dot{width:8px;height:8px;border-radius:50%;background:var(--aiw-accent-ink);flex:0 0 8px}
${adv} .${PREFIX}-rail-dot{position:absolute;top:7px;right:7px}
${adv} .${PREFIX}-rail-dot[hidden]{display:none}
${adv} .${PREFIX}-side-star{flex:0 0 auto;display:grid;place-items:center;width:var(--aiw-hit);height:var(--aiw-hit);border:0;border-radius:var(--aiw-radius-md);background:transparent;color:var(--aiw-muted);cursor:pointer;opacity:0;transition:opacity var(--aiw-dur-out) var(--aiw-ease)}
${adv} .${PREFIX}-side-item:hover .${PREFIX}-side-star,${adv} .${PREFIX}-side-item:focus-within .${PREFIX}-side-star,${adv} .${PREFIX}-side-star-on{opacity:1}
${adv} .${PREFIX}-side-star-on{color:var(--aiw-mark)}
${adv} .${PREFIX}-side-star-on svg{fill:currentColor}
@media (pointer:coarse){${adv} .${PREFIX}-side-star{opacity:1}}
${adv} .${PREFIX}-side-empty{padding:16px 10px;font-size:var(--aiw-font-sm);color:var(--aiw-muted)}
${adv} .${PREFIX}-side-foot{border-top:1px solid var(--aiw-border);padding:8px 10px}
${adv} .${PREFIX}-side-foot[hidden]{display:none}
${adv} .${PREFIX}-side-rail .${PREFIX}-ib{position:relative;width:40px;min-width:40px;height:40px}
${adv} .${PREFIX}-rail-foot{display:flex;justify-content:center;width:var(--aiw-rail-w);overflow:hidden}
${adv} .${PREFIX}-rail-foot .${PREFIX}-slot{width:var(--aiw-rail-w);overflow:hidden;display:flex;justify-content:center}
/* ── The page on the right ── */
${adv} .${PREFIX}-pane{position:relative;display:flex;flex:0 0 var(--aiw-pane-w);width:var(--aiw-pane-w);border-left:1px solid var(--aiw-border);animation:${PREFIX}-panein var(--aiw-dur-in) var(--aiw-ease)}
${adv}.${PREFIX}-pane-collapsed .${PREFIX}-pane{display:none}
${adv} .${PREFIX}-pane-ring::after{content:"";position:absolute;inset:0;border:2px solid var(--aiw-accent-ink);pointer-events:none;opacity:0;animation:${PREFIX}-ring calc(var(--aiw-dur-in) * 3) var(--aiw-ease)}
${adv} .${PREFIX}-resizer{display:block;flex:0 0 5px;align-self:stretch;cursor:col-resize;background:transparent;touch-action:none;position:relative;transition:background-color var(--aiw-dur-out) var(--aiw-ease)}
${adv} .${PREFIX}-resizer::after{content:"";position:absolute;top:0;bottom:0;left:-4px;right:-4px}
${adv} .${PREFIX}-resizer:hover,.${PREFIX}-resizing .${PREFIX}-resizer{background:var(--aiw-accent-ink)}
${adv}.${PREFIX}-pane-collapsed .${PREFIX}-resizer{display:none}
${adv} .${PREFIX}-pane-bar{min-height:48px;padding:0 6px 0 12px;gap:8px;background:var(--aiw-surface);font-size:var(--aiw-font-md)}
${adv} .${PREFIX}-pane-url{flex:1 1 auto;min-width:0;font-family:inherit;font-size:var(--aiw-font-sm);font-weight:600;color:var(--aiw-text-2)}
${adv} .${PREFIX}-pane-bar .${PREFIX}-icon{width:var(--aiw-hit);height:var(--aiw-hit);background:transparent;color:var(--aiw-text-2)}
${adv} .${PREFIX}-pane-bar .${PREFIX}-icon:hover{background:color-mix(in srgb,var(--aiw-text) 8%,transparent)}
${adv} .${PREFIX}-pane-back{display:none;align-items:center;gap:4px;min-height:var(--aiw-hit);padding:0 10px 0 4px;border:0;border-radius:var(--aiw-radius-md);background:transparent;color:var(--aiw-text);font:inherit;font-size:var(--aiw-font-sm);font-weight:600;cursor:pointer}
${phone} .${PREFIX}-pane{position:absolute;inset:0;z-index:5;flex:none;width:auto;border-left:0;animation:${PREFIX}-sheetin var(--aiw-dur-in) var(--aiw-ease)}
${phone} .${PREFIX}-pane-back{display:inline-flex}
${phone} .${PREFIX}-pane-collapse{display:none}
${phone} .${PREFIX}-resizer{display:none}
${phone} .${PREFIX}-pane-body{padding:8px}
`;
}
