import { WIDGET_LABELS, type WidgetLabels } from "./labels";

/**
 * THE WINDOW'S TURKISH (sgiant-platform#617).
 *
 * Every label of `WIDGET_LABELS`, in Turkish. The window chooses it by itself
 * when the host says the page is Turkish (`locale`), or, when the host says
 * nothing, when the page says so (`<html lang>`); see `builtInLabels`. A
 * host's own `labels` still win, label by label.
 *
 * Before this, each host carried its own copy of these sentences and a host
 * that carried none showed English on a Turkish page: every button, the
 * placeholder, the connection-lost sentence. A label added to the window
 * later reached such a host in English until somebody noticed.
 *
 * Typed as `WidgetLabels`, so a label added to `WIDGET_LABELS` without its
 * Turkish here does not compile.
 */
export const WIDGET_LABELS_TR: WidgetLabels = {
  widgetSourceEstimate: "Tahmini — ölçülmüş veri değil",
  widgetSourceProvided: "Sizin verdiğiniz rakamlar",
  questionConfirm: "Gönder",
  questionPlaceholder: "Cevabınızı yazın…",
  questionSendFailed: "Cevabınız gönderilemedi — mevcut yanıt bitene kadar bekleyin, sonra tekrar deneyin.",
  modelPicker: "Model",
  modelPickerAria: "Model: {model}. Başka bir model seçin",
  siteUnavailable: "Asistan şu anda bu sitede kullanılamıyor.",
  modelPickerUnavailable:
    "Model listesi yüklenemedi. Varsayılan model kullanılıyor.",
  openBubble: "{name} aç",
  openBubbleUnread: "{name} aç — {count} okunmamış",
  panelAria: "{name} sohbeti",
  newChat: "Yeni sohbet",
  pastConversations: "Geçmiş sohbetler",
  threadAnswering: "Yanıtlıyor…",
  streamLostRecovering: "Bağlantı koptu. Yanıt burada görünmezse mesajınızı yeniden gönderin.",
  history: "Geçmiş",
  moreOptions: "Diğer seçenekler",
  more: "Diğer",
  expandChat: "Sohbeti genişlet",
  expand: "Genişlet",
  restore: "Küçült",
  restoreChat: "Sohbet boyutunu geri al",
  closeChat: "Sohbeti kapat",
  conversation: "Sohbet",
  on: "Açık",
  off: "Kapalı",
  downloadChat: "Sohbeti indir (.txt)",
  flagConversation: "Bu sohbeti işaretle",
  flagConversationHint: "Bu sohbeti inceleme için işaretle",
  flagSendFirst: "Önce bir mesaj gönderin — sonra bu sohbeti işaretleyebilirsiniz.",
  flagPrompt: "Bu sohbeti işaretle — neden? (gerekçe inceleme için kaydedilir)",
  flagReasonPlaceholder: "Ne ters gitti?",
  flagSubmit: "İşaretle",
  flagged: "🚩 Sohbet inceleme için işaretlendi ✓",
  flagFailed: "İşaretlenemedi: {msg}",
  flagFailedGeneric: "lütfen tekrar deneyin",
  notificationSound: "Bildirim sesi",
  soundOnHint: "Yanıt geldiğinde ses çalar — sessize almak için tıklayın",
  soundOffHint: "Sessiz — yanıt sesini açmak için tıklayın",
  autoNavigate: "Otomatik yönlendirme",
  autoNavOnHint: "{name} sayfaları sizin için açar — kapatmak için tıklayın",
  autoNavOffHint: "{name} sayfaları açmadan önce sorar — açmak için tıklayın",
  autoNavPinnedHint: "Gelişmiş görünüm sayfaları her zaman kendisi açar — burada kapatılamaz",
  autoApply: "Otomatik uygula",
  autoApplyOnHint: "{name} güvenli değişiklikleri sizin için uygular — kapatmak için tıklayın",
  autoApplyOffHint: "{name} herhangi bir değişikliği uygulamadan önce sorar — açmak için tıklayın",
  automationHelp: "Otomasyon nasıl çalışır",
  automationHelpTitle: "{name} kendi başına ne yapabilir",
  automationHelpNav: "Otomatik yönlendirme — {name} sayfaları kendisi açar. Yalnızca sayfaları: bir şeyi değiştiren her işlem yine size sorar.",
  automationHelpNavPinned: "Gelişmiş görünümde {name} sayfaları her zaman kendisi açar. Gelişmiş görünüm zaten budur, bu yüzden burada kapatılamaz.",
  automationHelpApply: "Otomatik uygula — {name}, bu sitenin geri alınabilir olarak işaretlediği değişiklikleri (örneğin taslak kaydetmeyi) her seferinde sormadan uygular.",
  automationHelpNever: "Bu ayarlar ne olursa olsun asla otomatik yapılmaz: yayımlama, silme, kredi harcayan her şey ve sizin adınıza yazma veya tıklama. Bunlar her zaman önce size sorulur.",
  automationHelpLocal: "Her iki ayar da yalnızca bu tarayıcıda tutulur. Sizindir, sitenin değil; başkaları kendi ayarlarını görür.",
  automationHelpClose: "Kapat",
  roleTalk: "Sohbet",
  roleAnalytics: "Analitik",
  creditsSuffix: " kredi",
  askAnything: "{name} her sorunuzu yanıtlar…",
  messageAria: "{name} için mesaj yazın",
  send: "Gönder",
  removeAttachment: "{file} kaldır",
  attachFile: "Dosya ekle",
  attachFileHint: "Görsel, PDF veya belge ekleyin",
  jobTitleCoder: "Kod görevi yürütülüyor",
  jobTitleReport: "Rapor oluşturuluyor",
  jobTitleFallback: "Üzerinde çalışılıyor",
  jobQueued: "Sırada",
  jobRunning: "Çalışıyor",
  jobDone: "Tamamlandı",
  jobFailed: "Başarısız",
  jobCancelled: "İptal edildi",
  jobCancel: "İptal et",
  jobCancelling: "İptal ediliyor…",
  jobProgress: "{total} işlemden {done} tanesi",
  jobProgressOpen: "şu ana kadar {done}",
  jobOpenResult: "Sonucu aç",
  jobFlowAll: "Tüm {count} adımı göster",
  jobWatchingInPane: "Yan tarafta takip ediliyor →",
  paneBackToPage: "Sayfaya dön",
  paneShowingWidget: "Sonuç",
  jobUnreachable: "Arka planda çalışmaya devam ediyor — birazdan tekrar kontrol edin",
  jobEvCancelled: "İptal edildi",
  jobEvCancelledBeforeStart: "Başlamadan iptal edildi",
  jobEvInterrupted: "Yarıda kesildi ve kendiliğinden yeniden başlatılmadı",
  proposalGeneric: "Bu değişiklik uygulansın mı?",
  artifactsTitle: "Bu sohbetin dosyaları:",
  artifactSave: "Kaydet",
  artifactSaving: "Kaydediliyor…",
  apply: "Uygula",
  dismiss: "Kapat",
  applying: "Uygulanıyor…",
  applied: "Uygulandı",
  openReport: "Raporu aç",
  openResult: "Aç",
  tryAgain: "Tekrar dene",
  applyFailed: "Bu işlem tamamlanamadı.",
  close: "Kapat",
  loading: "Yükleniyor…",
  noConversations: "Henüz geçmiş sohbet yok.",
  untitledConversation: "Başlıksız sohbet",
  star: "Bu sohbeti yıldızla",
  unstar: "Yıldızı kaldır",
  historyLoadFailed: "Geçmiş yüklenemedi — tekrar deneyin.",
  bucketToday: "Bugün",
  bucketYesterday: "Dün",
  bucketWeek: "Bu hafta",
  bucketMonth: "Bu ay",
  bucketOlder: "Daha eski",
  submit: "Gönder",
  sending: "Gönderiliyor…",
  requiredFields: "Lütfen önce işaretli alanları doldurun.",
  done: "Tamam ✓",
  preview: "Önizleme",
  otherOption: "+ Diğer…",
  confirm: "Onayla",
  cancel: "İptal",
  errorSnag: "{name} bir sorunla karşılaştı ve yanıt veremedi. Lütfen tekrar deneyin.",
  reportIssue: "Sorun bildir",
  reporting: "Bildiriliyor…",
  reported: "Bildirildi ✓ — ekibimiz inceleyecek",
  reportFailed: "Bildirilemedi — daha sonra deneyin",
  qualitySlowTitle: "Bu biraz uzun sürdü — yanıt beklemeye değdi mi?",
  qualityFailedTitle: "Bu işe yaramadı — ne yapmaya çalışıyordunuz?",
  qualityReasonPlaceholder: "Eklemek istediğiniz bir şey var mı? (isteğe bağlı)",
  qualityFailedPlaceholder: "Ne yapmaya çalışıyordunuz?",
  qualitySend: "Gönder",
  qualityDismiss: "Hayır, teşekkürler",
  qualityThanks: "Teşekkürler — not edildi ✓",
  meterTokensLeft: "Ücretsiz önizlemede {count} kaldı",
  meterFreePreview: "Ücretsiz önizleme",
  meterUsedThisSession: "bu oturumda {count} kullanıldı",
  signupCta: "Kaydolun — 14 gün ücretsiz",
  uiStatusPending: "Bekliyor",
  uiStatusRunning: "Çalışıyor…",
  uiStatusReady: "Hazır",
  uiStatusFailed: "Başarısız",
  uiMediaPending: "Henüz oluşturulmadı",
  uiMediaMissing: "Kullanılamıyor",
  prev: "Önceki",
  next: "Sonraki",
  actionOpening: "{label} açılıyor…",
  actionDone: "{label} ✓",
  actionOpenFailed: "{label} açılamadı",
  actionRunFailed: "{label} çalıştırılamadı",
  actionRetry: "{label} — tekrar deneyin",
  actionShownOnPage: "Sayfada gösterildi",
  actionDoneOnPage: "Sayfada yapıldı",
  actionPageFailed: "Bu işlem sayfada yapılamadı",
  actionOpened: "Açıldı",
  threadOpenFailed: "Bu konuşma açılamadı.",
};

/**
 * The window's own words for a language (sgiant-platform#617).
 *
 * `said` is what the host said the page's language is (`locale`); `page` is
 * what the page says of itself (`<html lang>`), used only when the host said
 * nothing. Turkish for any Turkish tag ("tr", "tr-TR", "TR_tr"); English for
 * everything else, including a tag that is no language at all. A host that
 * names a language is believed over the page: an English app shown inside a
 * Turkish page asked for English.
 */
export function builtInLabels(
  said: string | undefined | null,
  page?: string | undefined | null
): WidgetLabels {
  return isTurkish(said, page) ? WIDGET_LABELS_TR : WIDGET_LABELS;
}

function isTurkish(
  said: string | undefined | null,
  page?: string | undefined | null
): boolean {
  const tag = (typeof said === "string" && said.trim() ? said : page) ?? "";
  return (
    typeof tag === "string" &&
    tag.trim().toLowerCase().split(/[-_]/)[0] === "tr"
  );
}

/**
 * WORDS THAT ARE NOT IN THE LABEL LIST.
 *
 * The two votes, Edit, Regenerate, the edit box's two buttons and the resize
 * handle are given by a host as options of their own (`voteUpLabel`,
 * `editLabel`, `resizeLabel` …), older than the label list, each with an
 * English default written where it is drawn. Three more had no option at
 * all: the two arrows between versions of a turn, and the description of a
 * card's picture. So a host that passed no words showed all of these in
 * English on a Turkish page while everything around them was Turkish.
 *
 * They are chosen like the labels: the host's own word first, else the
 * window's for the page's language.
 */
export interface WidgetOptionWords {
  voteUp: string;
  voteDown: string;
  edit: string;
  regenerate: string;
  cancel: string;
  save: string;
  /** The handle between the chat and the page beside it (`resizeLabel`). */
  resize: string;
  /** The view that puts the app beside the chat, and its page panel. */
  advanced: string;
  exitAdvanced: string;
  hidePane: string;
  showPane: string;
  /** The arrows between two versions of one turn; read out, never drawn. */
  prevVersion: string;
  nextVersion: string;
  /** A proposal card's picture, when the assistant gave it no description. */
  imageAlt: string;
  /** An action the assistant offered without naming it: a button that opens
   *  a page, the page in "Opening {label}…", and a button that runs
   *  something. */
  openPage: string;
  thePage: string;
  run: string;
}
export const WIDGET_OPTION_WORDS: WidgetOptionWords = {
  voteUp: "Helpful",
  voteDown: "Not helpful",
  edit: "Edit",
  regenerate: "Regenerate",
  cancel: "Cancel",
  save: "Save & send",
  resize: "Drag to resize · double-click to reset",
  advanced: "Advanced view",
  exitAdvanced: "Exit advanced view",
  hidePane: "Hide page",
  showPane: "Show page",
  prevVersion: "Previous version",
  nextVersion: "Next version",
  imageAlt: "Web image preview",
  openPage: "Open page",
  thePage: "the page",
  run: "Run",
};
export const WIDGET_OPTION_WORDS_TR: WidgetOptionWords = {
  voteUp: "Faydalı",
  voteDown: "Faydasız",
  edit: "Düzenle",
  regenerate: "Yeniden oluştur",
  cancel: "İptal",
  save: "Kaydet ve gönder",
  resize: "Boyutlandırmak için sürükleyin · sıfırlamak için çift tıklayın",
  advanced: "Gelişmiş görünüm",
  exitAdvanced: "Gelişmiş görünümden çık",
  hidePane: "Sayfayı gizle",
  showPane: "Sayfayı göster",
  prevVersion: "Önceki sürüm",
  nextVersion: "Sonraki sürüm",
  imageAlt: "Web görseli önizlemesi",
  openPage: "Sayfayı aç",
  thePage: "Sayfa",
  run: "Çalıştır",
};
export function builtInOptionWords(
  said: string | undefined | null,
  page?: string | undefined | null
): WidgetOptionWords {
  return isTurkish(said, page) ? WIDGET_OPTION_WORDS_TR : WIDGET_OPTION_WORDS;
}

