/**
 * English (US). See pt-BR.js for the `ctx` shape.
 */
export default {
  htmlLang: "en-US",
  localeCode: "en-US",
  decimal: ".",

  files: {
    reportsDir: "reports",
    reportPrefix: "report",
    list: {
      "com-site": { file: "with-website", label: "With website" },
      "sem-site": { file: "without-website", label: "Without website" },
    },
  },

  cta: {
    type: "email",
    subject: "Website preview request",
    message: "Hi! I came from the report and I'd like to see the preview of the website your team made for me!",
  },

  strings(ctx) {
    const { notaDisp, reviews, band, perdaEm10, score10, tag } = ctx;
    const reviewsTxt = reviews ? String(reviews) : "numerous";

    const resumo = {
      low: {
        r1: `Your website is leaving money on the table. The good news: the problem isn't your business — it's the digital storefront, and that's a quick fix.`,
        r2: `Your ${notaDisp}★ rating with ${reviewsTxt} reviews puts you among the best-rated businesses in your area. But people who click through to your site find an experience that doesn't match that quality — and they leave before buying.`,
      },
      mid: {
        r1: `Your website works, but it's far from its potential. There are clear issues that, once fixed, unlock conversions you're losing today.`,
        r2: `With ${notaDisp}★ and ${reviewsTxt} reviews, you attract the right customer. The fixes below make sure they don't give up halfway through.`,
      },
      high: {
        r1: `Your website is in good technical shape — which is rare. Even so, there are refinements that separate a "good" site from one that sells on autopilot.`,
        r2: `Your reputation (${notaDisp}★, ${reviewsTxt} reviews) and a solid site are a strong combination. Let's amplify what's already working.`,
      },
    }[band];

    return {
      reviewsFallback: "numerous",
      outOf10: `out of 10`,
      tagline: `Digital Presence Audit`,
      kickerAudit: `Audit`,
      footerPrefix: `Audit generated on`,
      overall: `Overall result`,
      secRepVsSite: `Your reputation vs. your site`,
      whatBuilt: `What you've built`,
      googleRating: `Google rating`,
      numReviews: `Number of reviews`,
      reputation: `Reputation`,
      whatClientFinds: `What the customer finds`,
      secDiagnosis: `Point-by-point diagnosis`,
      secCost: `What this is costing you`,
      conservativeEst: `Conservative estimate`,
      nextStep: `Next step`,
      ctaRebuild: `See the rebuilt version`,

      grade: { ok: `Good`, warn: `Needs work`, red: `Critical`, none: `No data` },
      rank: {
        best: `Among the best`,
        veryGood: `Very well rated`,
        good: `Well rated`,
        rated: `Rated`,
      },
      contraste: {
        tempoCarregar: `Time to load`,
        notaPerf: `Performance score`,
        respInteragir: `Response when tapping`,
      },

      subtitle: `You've built a reputation few competitors have: ${notaDisp}★ with ${reviewsTxt} reviews. This report shows, point by point, why your site isn't turning that reputation into customers yet — and what changes when it finally matches the quality of your service.`,
      resumo1: resumo.r1,
      resumo2: resumo.r2,

      impactoDestaque:
        score10 >= 8
          ? `Your site keeps almost every customer your reputation attracts — and there's still room to raise the bar.`
          : `For every 10 customers who open your site from Google, about <strong style="color:var(--accent);">${perdaEm10}</strong> give up before seeing your offer.`,
      impactoTexto: `Notice: it's not a lack of demand — your reputation proves the demand is there. It's the site experience blocking the sale at the last step. Recovering that share doesn't require spending more on ads; it requires a site worthy of your service.`,

      proximoTitulo: `Your website can work as well as you serve your customers.`,
      proximoTexto: `We rebuild your digital presence so it loads in the blink of an eye, works flawlessly on mobile, and turns your reputation into bookings and sales. Here's what your site could look like.`,

      dims: {
        lcp: {
          title: `Loading speed`,
          unit: `first view on mobile`,
          explain:
            tag.lcp === "ok"
              ? `Your site shows its main content in <strong>${ctx.lcpDisp}</strong> — within Google's recommended range. That's an asset: the customer who clicks doesn't wait, and the buying impulse your reputation creates is preserved.`
              : `Your site takes <strong>${ctx.lcpDisp}</strong> to show its main content on mobile. Google has proven that past 3 seconds, more than half of people give up before the page even opens. In practice: you have ${reviewsTxt} reviews and a ${notaDisp} rating — customers who arrive ready to buy click your site and hit a still-blank screen. Today, this is probably the biggest drain on your online business.`,
        },
        tbt: {
          title: `Response to touch`,
          unit: `frozen time`,
          explain:
            tag.tbt === "ok"
              ? `When tapping buttons and scrolling, the site responds instantly. That smoothness conveys the same confidence your reviews already do.`
              : `When the customer tries to tap a button or scroll, the site freezes for <strong>${ctx.tbtDisp}</strong>. That "stuck" feeling makes the business seem fragile or outdated — the exact opposite of the trust your ${reviewsTxt} reviews have earned.`,
        },
        cls: {
          title: `Visual stability`,
          unit: `layout shift`,
          explain:
            tag.cls === "ok"
              ? `Elements stay put while the page loads. The customer clicks exactly where they mean to, with no mistakes — an experience that doesn't get in the way of the sale.`
              : `While the page loads, elements "jump" around (index ${ctx.clsDisp}). The customer goes to tap "book" or "buy" and ends up tapping something else. That frustration, repeated, makes many people simply close the site.`,
        },
        seo: {
          title: `Being found on Google`,
          unit: `SEO score /100`,
          explain:
            tag.seo === "ok"
              ? `Your site is well structured for Google. That helps you show up for people searching for your service too, not just on Maps.`
              : `Your SEO is at <strong>${ctx.seo}/100</strong>. Right now you depend almost entirely on Google Maps to be found. A well-structured site also captures people typing your service into Google — new customers who, at this moment, go straight to the competitor showing up ahead of you.`,
        },
        a11y: {
          title: `Experience and accessibility`,
          unit: `accessibility /100`,
          explain:
            tag.a11y === "ok"
              ? `Your site is easy to read and use on any screen. Since most customers visit from their phones, that counts strongly in your favor.`
              : `Accessibility is at <strong>${ctx.a11y}/100</strong> — it measures how easy the site is to read and use (contrast, text size, mobile navigation). A large share of your customers reach you from their phones, often on the go; problems here push away exactly the people ready to buy right now.`,
        },
        bp: {
          title: `Trust and security`,
          unit: `best practices /100`,
          explain:
            tag.bp === "ok"
              ? `Your site follows modern security and quality standards. The "secure site" padlock conveys credibility in the very first second.`
              : `Best practices are at <strong>${ctx.bp}/100</strong> — security and modern standards (HTTPS, correct images, no errors). A "not secure" warning or a visible glitch destroys, in seconds, the trust your reputation took years to build.`,
        },
      },
    };
  },
};
