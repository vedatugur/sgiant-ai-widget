import test from "node:test";
import assert from "node:assert/strict";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";
import {
  checkValue,
  parseSiteFormDirective,
  prefillFor,
  readSiteForms,
  siteFormAddresses,
  type SiteFormField,
} from "../dist/site-form.js";
import { WIDGET_LABELS } from "../dist/labels.js";
import { WIDGET_LABELS_TR } from "../dist/labels-tr.js";

/**
 * A BUSINESS'S FORM OPENS IN THE CHAT ON ITS SITE (sgiant-platform#550).
 *
 * The assistant names a form and may suggest what the visitor said; the
 * window draws the BUSINESS'S form, read from the api at that moment, and
 * puts a suggestion only into a field the form has, as a value that fits it.
 * The words are the owner's (29 Oct 2026), letter for letter.
 */

test("the form's words, as approved, in both languages", () => {
  const pick = (L: Record<string, string>) =>
    Object.fromEntries(Object.entries(L).filter(([k]) => k.startsWith("siteForm")));
  assert.deepEqual(pick(WIDGET_LABELS_TR), {
    siteFormOptional: "(isteğe bağlı)",
    siteFormPrefilled: "Sohbetinizden dolduruldu; değiştirebilirsiniz.",
    siteFormSend: "Gönder",
    siteFormNotNow: "Şimdi değil",
    siteFormPrivacy: "Gizlilik metni",
    siteFormRequired: "Bu alanı doldurun.",
    siteFormPhone: "Telefon numarası eksik ya da hatalı görünüyor.",
    siteFormEmail: "E-posta adresi hatalı görünüyor.",
    siteFormDateOrder: "Çıkış tarihi girişten sonra olmalı.",
    siteFormConsent: "Devam etmek için izin kutusunu işaretleyin.",
    siteFormFailed: "Gönderilemedi. Bilgileriniz formda duruyor; yeniden deneyin.",
    siteFormCheckIn: "Giriş",
    siteFormCheckOut: "Çıkış",
    siteFormThanks: "Teşekkürler, talebiniz bize ulaştı. En kısa sürede size dönüş yapacağız.",
    siteFormNumberRange: "Bir sayı yazın: en az {min}, en çok {max}.",
    siteFormNumberMin: "Bir sayı yazın: en az {min}.",
    siteFormNumberMax: "Bir sayı yazın: en çok {max}.",
    siteFormClosed: "Bu form artık gönderilemiyor. Talebinizi buraya yazabilirsiniz.",
  });
  assert.deepEqual(pick(WIDGET_LABELS), {
    siteFormOptional: "(optional)",
    siteFormPrefilled: "Filled in from your chat; you can change it.",
    siteFormSend: "Send",
    siteFormNotNow: "Not now",
    siteFormPrivacy: "Privacy notice",
    siteFormRequired: "Please fill in this field.",
    siteFormPhone: "The phone number looks incomplete or wrong.",
    siteFormEmail: "The email address looks wrong.",
    siteFormDateOrder: "The check-out date must be after the check-in date.",
    siteFormConsent: "Tick the consent box to continue.",
    siteFormFailed: "It could not be sent. Your details are still in the form; please try again.",
    siteFormCheckIn: "Check-in",
    siteFormCheckOut: "Check-out",
    siteFormThanks: "Thank you, we have your request. We will get back to you as soon as we can.",
    siteFormNumberRange: "Enter a number: at least {min}, at most {max}.",
    siteFormNumberMin: "Enter a number: at least {min}.",
    siteFormNumberMax: "Enter a number: at most {max}.",
    siteFormClosed: "This form can no longer be sent. You can write your request here.",
  });
});

test("the directive names a form and suggestions; nothing else of it is used", () => {
  const r = parseSiteFormDirective(
    'Talebinizi iletebilirsiniz. [[site-form:{"id":"f1","prefill":{"people":"2"},"fields":[{"id":"x"}]}]]'
  );
  assert.ok(r);
  assert.equal(r!.stripped, "Talebinizi iletebilirsiniz.");
  assert.deepEqual(r!.spec, { id: "f1", prefill: { people: "2" } });
  assert.equal(parseSiteFormDirective("no form here"), null);
});

test("a suggestion is kept only when it fits its field", () => {
  const f = (type: SiteFormField["type"], options?: string[]): SiteFormField => ({
    id: "x",
    type,
    label: "x",
    required: false,
    ...(options ? { options } : {}),
  });
  assert.deepEqual(prefillFor(f("dateRange"), { from: "2027-06-12", to: "2027-06-16" }), {
    from: "2027-06-12",
    to: "2027-06-16",
  });
  assert.equal(prefillFor(f("dateRange"), "12-16 June"), undefined);
  assert.equal(prefillFor(f("select", ["Standart", "Aile"]), "Kral dairesi"), undefined);
  assert.equal(prefillFor(f("select", ["Standart", "Aile"]), "Aile"), "Aile");
  assert.deepEqual(prefillFor(f("multi", ["A", "B"]), ["B", "Z"]), ["B"]);
  assert.equal(prefillFor(f("date"), "June 12"), undefined);
  assert.equal(prefillFor(f("time"), "19:30"), "19:30");
  assert.equal(prefillFor(f("number"), "iki"), undefined);
  assert.equal(prefillFor(f("checkbox"), true), "true");
});

test("the window's own checks name the sentence a visitor reads", () => {
  const f = (type: SiteFormField["type"], required = true): SiteFormField => ({
    id: "x",
    type,
    label: "x",
    required,
  });
  assert.equal(checkValue(f("text"), ""), "required");
  assert.equal(checkValue(f("text", false), ""), null);
  assert.equal(checkValue(f("phone"), "123"), "phone");
  assert.equal(checkValue(f("phone"), "+90 532 000 00 00"), null);
  assert.equal(checkValue(f("email"), "a@"), "email");
  assert.equal(checkValue(f("dateRange"), { from: "2027-06-16", to: "2027-06-12" }), "dateOrder");
  assert.equal(checkValue(f("dateRange"), { from: "2027-06-12", to: "" }), "required");
  assert.equal(checkValue(f("checkbox"), "false"), "required");
  assert.equal(checkValue({ ...f("number"), min: 1, max: 12 }, "40"), "number");
  assert.equal(checkValue(f("number"), "iki"), "required");
});

test("a read that does not fit is no forms, and the addresses sit beside the settings", () => {
  assert.equal(readSiteForms({ forms: [] }), null);
  assert.equal(
    readSiteForms({ privacyUrl: "http://x.example", consent: { tr: "a", en: "b" }, forms: [] }),
    null
  );
  const ok = readSiteForms({
    privacyUrl: "https://x.example/p",
    consent: { tr: "a", en: "b" },
    forms: [{ id: "f", name: "F", fields: [{ id: "a", type: "signature", label: "?" }, { id: "b", type: "text", label: "B" }] }],
  });
  assert.deepEqual(ok!.forms[0]!.fields.map((x) => x.id), ["b"]);
  assert.deepEqual(siteFormAddresses("https://api.example/public/ai/site-settings"), {
    forms: "https://api.example/public/ai/site-forms",
    submit: "https://api.example/public/ai/site-forms/submit",
  });
});

const CONSENT_TR =
  "Bilgilerimin Blue Bay tarafından bu talebe dönmek için kullanılmasını kabul ediyorum.";

test(
  "in a browser: the business's form is drawn, prefilled only where it fits, and sent from the conversation",
  { skip: SKIP_WITHOUT_CHROME },
  async () => {
    await withBrowser(async (page) => {
      await page.open([1280, 900]);
      const seen = await page.evaluate<any>(`(${async (consent: string) => {
        const P = "sgiant-aiw";
        const g = window as unknown as { SgiantAiWidget: any };
        const sent: any[] = [];
        let formId = "form1";
        let thread = "thr_1";
        let submitAnswer: { status: number; body: unknown } = { status: 201, body: { ok: true, thanks: null } };
        window.fetch = (async (input: any, init?: any) => {
          const url = String(typeof input === "string" ? input : input.url);
          const json = (b: unknown, status = 200) =>
            new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
          if (url.includes("/site-settings"))
            return json({ answersVisitors: true, name: "Blue Bay", language: "tr" });
          if (url.includes("/site-forms/submit")) {
            sent.push(JSON.parse(init.body));
            return json(submitAnswer.body, submitAnswer.status);
          }
          if (url.includes("/site-forms"))
            return json({
              privacyUrl: "https://bluebay.example/gizlilik",
              consent: { tr: consent, en: "I agree." },
              forms: [
                {
                  id: "form1",
                  name: "Rezervasyon talebi",
                  thanks: null,
                  fields: [
                    { id: "stay", type: "dateRange", label: "Giriş ve çıkış tarihi", required: true },
                    { id: "people", type: "number", label: "Kişi sayısı", required: true, min: 1, max: 12 },
                    { id: "room", type: "select", label: "Oda tipi", required: false, options: ["Standart", "Deniz manzaralı"] },
                    { id: "name", type: "text", label: "Adınız soyadınız", required: true },
                    { id: "phone", type: "phone", label: "Telefon", required: true },
                  ],
                },
              ],
            });
          const reply = `Talebinizi otele iletebilirim. [[site-form:{"id":"${formId}","prefill":{"stay":{"from":"2027-06-12","to":"2027-06-16"},"people":"2","room":"Kral dairesi","password":"x"}}]]`;
          return new Response(
            [{ type: "thread", threadId: thread }, { type: "text", d: reply }, { type: "done" }]
              .map((f) => JSON.stringify(f) + "\n")
              .join(""),
            { status: 200, headers: { "content-type": "application/x-ndjson" } }
          );
        }) as typeof fetch;
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const ask = async (q: string) => {
          const box = document.querySelector('[data-ai-target="widget-composer"]') as HTMLTextAreaElement;
          box.value = q;
          box.closest("form")!.requestSubmit();
          await wait(700);
        };
        const h = await g.SgiantAiWidget.createSiteChat({
          endpoint: "https://api.example/public/ai/chat",
          siteKey: "pk_bb",
          settingsUrl: "https://api.example/public/ai/site-settings",
        });
        h.open();
        await wait(300);
        await ask("Haziranda 12-16 arası iki kişi yer var mı?");
        const form = document.querySelector(`.${P}-site-form`) as HTMLElement;
        const out: any = {
          drawn: !!form,
          title: form?.querySelector(`.${P}-form-title`)?.textContent,
          labels: [...(form?.querySelectorAll(`.${P}-site-form-label`) ?? [])].map((x) => x.textContent),
          from: (form?.querySelector('input[id$="-stay-from"]') as HTMLInputElement)?.value,
          to: (form?.querySelector('input[id$="-stay-to"]') as HTMLInputElement)?.value,
          people: (form?.querySelector('input[id$="-people"]') as HTMLInputElement)?.value,
          room: (form?.querySelector('select[id$="-room"]') as HTMLSelectElement)?.value,
          prefilled: form?.querySelector(`.${P}-site-form-prefilled`)?.textContent,
          consent: form?.querySelector(`.${P}-site-form-consent`)?.textContent,
          privacy: (form?.querySelector(`.${P}-site-form-privacy`) as HTMLAnchorElement)?.href,
          raw: document.querySelector(`.${P}-panel`)?.textContent?.includes("[[site-form"),
          inputs: form?.querySelectorAll("input,select,textarea").length,
        };
        // Sent without consent and a name: held, with the sentences.
        (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
        await wait(100);
        out.held = [...form.querySelectorAll(`.${P}-form-err`)]
          .filter((e) => !(e as HTMLElement).hidden)
          .map((e) => e.textContent);
        out.sentWhileHeld = sent.length;
        (form.querySelector('input[id$="-name"]') as HTMLInputElement).value = "Elif Kaya";
        (form.querySelector('input[id$="-phone"]') as HTMLInputElement).value = "+90 532 000 00 00";
        (form.querySelector(`.${P}-site-form-consent input`) as HTMLInputElement).checked = true;
        // A count above the form's bound is said with its bounds.
        (form.querySelector('input[id$="-people"]') as HTMLInputElement).value = "40";
        (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
        await wait(100);
        out.range = [...form.querySelectorAll(`.${P}-form-err`)]
          .filter((e) => !(e as HTMLElement).hidden)
          .map((e) => e.textContent);
        (form.querySelector('input[id$="-people"]') as HTMLInputElement).value = "2";
        // The api refuses the phone: said on that field, everything kept.
        submitAnswer = { status: 400, body: { code: "FIELDS", problems: { phone: "phone" } } };
        (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
        await wait(150);
        out.serverHeld = [...form.querySelectorAll(`.${P}-form-err`)]
          .filter((e) => !(e as HTMLElement).hidden)
          .map((e) => e.textContent);
        out.keptName = (form.querySelector('input[id$="-name"]') as HTMLInputElement).value;
        submitAnswer = { status: 201, body: { ok: true, thanks: null } };
        (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
        await wait(150);
        out.sent = sent[sent.length - 1];
        out.thanks = document.querySelector(`.${P}-site-form .${P}-lead-ok`)?.textContent;

        // In a new conversation: "Şimdi değil" takes it away; an id the
        // business does not have draws nothing.
        thread = "thr_2";
        await ask("Bir daha?");
        const second = [...document.querySelectorAll(`.${P}-site-form`)].pop() as HTMLElement;
        (second.querySelector(`.${P}-site-form-later`) as HTMLButtonElement).click();
        out.afterNotNow = document.querySelectorAll(`.${P}-site-form`).length;
        formId = "not-theirs";
        await ask("Ve bir daha?");
        out.afterUnknown = document.querySelectorAll(`.${P}-site-form`).length;
        h.destroy();
        return out;
      }})(${JSON.stringify(CONSENT_TR)})`);

      assert.equal(seen.drawn, true, "no form was drawn");
      assert.equal(seen.raw, false, "the directive was shown as text");
      assert.equal(seen.title, "Rezervasyon talebi");
      assert.deepEqual(seen.labels, [
        "Giriş ve çıkış tarihi",
        "Kişi sayısı",
        "Oda tipi (isteğe bağlı)",
        "Adınız soyadınız",
        "Telefon",
      ]);
      assert.equal(seen.from, "2027-06-12");
      assert.equal(seen.to, "2027-06-16");
      assert.equal(seen.people, "2");
      assert.equal(seen.room, "", "a choice the form does not have was put in");
      assert.equal(seen.prefilled, "Sohbetinizden dolduruldu; değiştirebilirsiniz.");
      assert.equal(seen.consent, `${CONSENT_TR} Gizlilik metni`);
      assert.equal(seen.privacy, "https://bluebay.example/gizlilik");
      // Five fields (one of them two dates), the hidden field, the consent box.
      assert.equal(seen.inputs, 8);
      assert.deepEqual(seen.held, [
        "Bu alanı doldurun.",
        "Bu alanı doldurun.",
        "Devam etmek için izin kutusunu işaretleyin.",
      ]);
      assert.equal(seen.sentWhileHeld, 0);
      assert.deepEqual(seen.range, ["Bir sayı yazın: en az 1, en çok 12."]);
      assert.deepEqual(seen.serverHeld, ["Telefon numarası eksik ya da hatalı görünüyor."]);
      assert.equal(seen.keptName, "Elif Kaya");
      assert.deepEqual(seen.sent, {
        siteKey: "pk_bb",
        formId: "form1",
        threadId: "thr_1",
        answers: {
          stay: { from: "2027-06-12", to: "2027-06-16" },
          people: "2",
          room: "",
          name: "Elif Kaya",
          phone: "+90 532 000 00 00",
        },
        consent: true,
        consentText: CONSENT_TR,
        website: "",
      });
      assert.equal(
        seen.thanks,
        "Teşekkürler, talebiniz bize ulaştı. En kısa sürede size dönüş yapacağız."
      );
      assert.equal(seen.afterNotNow, 1, "Şimdi değil left the form");
      assert.equal(seen.afterUnknown, 1, "a form the business does not have was drawn");
    });
  }
);

test("a replayed reply loses its form directive, and leaves no note", async () => {
  const { stripDirectivesForReplay } = await import("../dist/specs.js");
  const r = stripDirectivesForReplay(
    'Talebinizi iletebilirsiniz. [[site-form:{"id":"f1","prefill":{"people":"2"}}]]'
  );
  assert.equal(r.clean, "Talebinizi iletebilirsiniz.");
  assert.deepEqual(r.notes, []);
});

test(
  "in a browser: one form per conversation, a send in flight sends once, and only a site window draws it",
  { skip: SKIP_WITHOUT_CHROME },
  async () => {
    await withBrowser(async (page) => {
      await page.open([1280, 900]);
      const seen = await page.evaluate<any>(`(${async () => {
        const P = "sgiant-aiw";
        const g = window as unknown as { SgiantAiWidget: any };
        const reads: string[] = [];
        const posts: any[] = [];
        let release: () => void = () => undefined;
        let answer = { status: 201, body: { ok: true, thanks: null } as unknown };
        window.fetch = (async (input: any, init?: any) => {
          const url = String(typeof input === "string" ? input : input.url);
          const json = (b: unknown, status = 200) =>
            new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
          if (url.includes("/site-settings")) return json({ answersVisitors: true, name: "Blue Bay", language: "tr" });
          if (url.includes("/site-forms/submit")) {
            posts.push(JSON.parse(init.body));
            await new Promise<void>((r) => (release = r));
            return json(answer.body, answer.status);
          }
          if (url.includes("/site-forms")) {
            reads.push(url);
            return json({
              privacyUrl: "https://bluebay.example/gizlilik",
              consent: { tr: "Kabul.", en: "OK." },
              forms: [{ id: "f1", name: "Sizi arayalım", thanks: null, fields: [{ id: "n", type: "text", label: "Ad", required: true }] }],
            });
          }
          return new Response(
            [{ type: "thread", threadId: "thr_9" }, { type: "text", d: 'A [[site-form:{"id":"f1"}]] B [[site-form:{"id":"f1"}]] C' }, { type: "done" }]
              .map((f) => JSON.stringify(f) + "\n")
              .join(""),
            { status: 200, headers: { "content-type": "application/x-ndjson" } }
          );
        }) as typeof fetch;
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const ask = async (q: string) => {
          const box = document.querySelector('[data-ai-target="widget-composer"]') as HTMLTextAreaElement;
          box.value = q;
          box.closest("form")!.requestSubmit();
          await wait(700);
        };
        const out: any = {};
        const h = await g.SgiantAiWidget.createSiteChat({ endpoint: "https://api.example/public/ai/chat", siteKey: "pk_x", settingsUrl: "https://api.example/public/ai/site-settings" });
        h.open();
        await wait(300);
        await ask("Arar mısınız?");
        const forms = () => document.querySelectorAll(`.${P}-site-form`);
        out.drawnFromTwo = forms().length;
        out.text = [...document.querySelectorAll(`.${P}-msg.${P}-assistant`)].pop()?.textContent;
        const form = forms()[0] as HTMLElement;
        const trap = form.querySelector(`.${P}-site-form-trap`) as HTMLInputElement;
        out.trap = { tab: trap.tabIndex, hidden: trap.getAttribute("aria-hidden") };
        out.max = (form.querySelector('input[id$="-n"]') as HTMLInputElement).maxLength;
        (form.querySelector('input[id$="-n"]') as HTMLInputElement).value = "Elif";
        (form.querySelector(`.${P}-site-form-consent input`) as HTMLInputElement).checked = true;
        const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
        btn.click();
        await wait(50);
        out.disabledWhileSending = btn.disabled;
        btn.click();
        form.querySelector("form")!.requestSubmit();
        await wait(50);
        out.postsInFlight = posts.length;
        release();
        await wait(100);
        out.thanked = !!form.querySelector(`.${P}-lead-ok`);
        // The same conversation asks again: nothing is drawn or read.
        const readsBefore = reads.length;
        await ask("Bir daha?");
        out.formsAfterSent = forms().length;
        out.readsAfterSent = reads.length - readsBefore;
        h.destroy();

        // A form that can no longer be sent says so and offers no button.
        out.closed = await (async () => {
          const h2 = await g.SgiantAiWidget.createSiteChat({ endpoint: "https://api.example/public/ai/chat", siteKey: "pk_y", settingsUrl: "https://api.example/public/ai/site-settings" });
          h2.open();
          await wait(300);
          answer = { status: 403, body: { code: "NO_CONVERSATION" } };
          await ask("Arar mısınız?");
          const f2 = [...forms()].pop() as HTMLElement;
          (f2.querySelector('input[id$="-n"]') as HTMLInputElement).value = "Elif";
          (f2.querySelector(`.${P}-site-form-consent input`) as HTMLInputElement).checked = true;
          (f2.querySelector('button[type="submit"]') as HTMLButtonElement).click();
          await wait(50);
          release();
          await wait(100);
          const r = {
            said: [...f2.querySelectorAll(`.${P}-form-err`)].filter((e) => !(e as HTMLElement).hidden).map((e) => e.textContent),
            button: !!f2.querySelector('button[type="submit"]'),
          };
          h2.destroy();
          return r;
        })();

        // A window that is not a site's: stripped, nothing read or drawn.
        reads.length = 0;
        const plain = g.SgiantAiWidget.createAiChatWidget({ endpoint: "https://api.example/public/ai/chat", title: "AYCA" });
        plain.open();
        await wait(300);
        await ask("Merhaba");
        out.plain = {
          drawn: forms().length,
          reads: reads.length,
          raw: document.querySelector(`.${P}-panel`)?.textContent?.includes("[[site-form"),
        };
        plain.destroy();
        return out;
      }})()`);
      assert.equal(seen.drawnFromTwo, 1);
      assert.ok(!seen.text.includes("[[site-form"), seen.text);
      assert.deepEqual(seen.trap, { tab: -1, hidden: "true" });
      assert.equal(seen.max, 200);
      assert.equal(seen.disabledWhileSending, true);
      assert.equal(seen.postsInFlight, 1, "a send in flight was sent again");
      assert.equal(seen.thanked, true);
      assert.equal(seen.formsAfterSent, 1, "a second form was drawn after one was sent");
      assert.equal(seen.readsAfterSent, 0);
      assert.deepEqual(seen.closed, {
        said: ["Bu form artık gönderilemiyor. Talebinizi buraya yazabilirsiniz."],
        button: false,
      });
      assert.deepEqual(seen.plain, { drawn: 0, reads: 0, raw: false });
    });
  }
);
