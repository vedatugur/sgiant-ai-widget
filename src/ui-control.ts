/**
 * The pure-DOM UI-control primitives now live in `@sgiant/ai-agent-bridge` (the
 * generic, open-source-shareable package that both this widget and the framed
 * agent depend on). This module re-exports them so the widget's existing imports
 * (`./ui-control`) keep working unchanged — one source of truth, no duplication.
 */
export {
  UI_CONTROL_ACTIONS,
  isUiControlAction,
  scanAiTargets,
  clearHighlight,
  runUiControl,
  OPERATE_ACTIONS,
  isOperateAction,
  runOperateAction,
  type UiControlAction,
  type AiTargetInfo,
  type OperateAction,
} from "@sgiant/ai-agent-bridge";
