/**
 * Español (neutro / internacional). Ver pt-BR.js para la forma de `ctx`.
 */
export default {
  htmlLang: "es",
  localeCode: "es-ES",
  decimal: ",",

  files: {
    reportsDir: "informes",
    reportPrefix: "informe",
    list: {
      "com-site": { file: "con-sitio-web", label: "Con sitio web" },
      "sem-site": { file: "sin-sitio-web", label: "Sin sitio web" },
    },
  },

  cta: {
    type: "whatsapp",
    message:
      "¡Hola! Vengo del informe y me gustaría ver la vista previa del sitio que el equipo hizo para mí.",
  },

  strings(ctx) {
    const { notaDisp, reviews, band, perdaEm10, score10, tag } = ctx;
    const reviewsTxt = reviews ? String(reviews) : "numerosas";

    const resumo = {
      low: {
        r1: `Tu sitio web está dejando dinero sobre la mesa. La buena noticia es que el problema no es tu negocio, sino el escaparate digital, y eso tiene una solución rápida.`,
        r2: `Tu valoración de ${notaDisp}★ con ${reviewsTxt} reseñas te coloca entre los mejor valorados de tu zona. Pero quien entra en tu sitio encuentra una experiencia que no está a la altura de esa calidad, y se va antes de comprar.`,
      },
      mid: {
        r1: `Tu sitio funciona, pero está lejos de su potencial. Hay puntos claros que, una vez corregidos, liberan conversiones que hoy se te escapan.`,
        r2: `Con ${notaDisp}★ y ${reviewsTxt} reseñas, atraes al cliente adecuado. Los ajustes de abajo garantizan que no abandone a mitad de camino.`,
      },
      high: {
        r1: `Tu sitio está en buen nivel técnico, algo poco común. Aun así, hay refinamientos que separan un sitio "bueno" de uno que vende en piloto automático.`,
        r2: `Tu reputación (${notaDisp}★, ${reviewsTxt} reseñas) y un sitio sólido son una combinación potente. Vamos a potenciar lo que ya funciona.`,
      },
    }[band];

    return {
      reviewsFallback: "numerosas",
      outOf10: `de 10`,
      tagline: `Auditoría de Presencia Digital`,
      kickerAudit: `Auditoría`,
      footerPrefix: `Auditoría generada el`,
      overall: `Resultado general`,
      secRepVsSite: `Tu reputación vs. tu sitio`,
      whatBuilt: `Lo que has construido`,
      googleRating: `Valoración en Google`,
      numReviews: `N.º de reseñas`,
      reputation: `Reputación`,
      whatClientFinds: `Lo que encuentra el cliente`,
      secDiagnosis: `Diagnóstico punto por punto`,
      secCost: `Lo que te está costando`,
      conservativeEst: `Estimación conservadora`,
      nextStep: `Siguiente paso`,
      ctaRebuild: `Ver la versión reconstruida`,

      grade: { ok: `Bueno`, warn: `Atención`, red: `Crítico`, none: `Sin datos` },
      rank: {
        best: `Entre los mejores`,
        veryGood: `Muy bien valorado`,
        good: `Bien valorado`,
        rated: `Valorado`,
      },
      contraste: {
        tempoCarregar: `Tiempo de carga`,
        notaPerf: `Puntuación de rendimiento`,
        respInteragir: `Respuesta al interactuar`,
      },

      subtitle: `Has construido una reputación que pocos competidores tienen: ${notaDisp}★ con ${reviewsTxt} reseñas. Este informe muestra, punto por punto, por qué tu sitio todavía no está convirtiendo esa reputación en clientes, y qué cambia cuando esté a la altura de tu atención.`,
      resumo1: resumo.r1,
      resumo2: resumo.r2,

      impactoDestaque:
        score10 >= 8
          ? `Tu sitio conserva a casi todos los clientes que atrae tu reputación, y aún hay margen para subir el listón.`
          : `Por cada 10 clientes que abren tu sitio desde Google, alrededor de <strong style="color:var(--accent);">${perdaEm10}</strong> abandonan antes de ver tu oferta.`,
      impactoTexto: `Fíjate: no es falta de demanda; tu reputación demuestra que la demanda existe. Es la experiencia del sitio la que frena la venta en el último paso. Recuperar esa parte no exige gastar más en anuncios; exige un sitio a la altura de tu atención.`,

      proximoTitulo: `Tu sitio puede trabajar tan bien como tú atiendes.`,
      proximoTexto: `Reconstruimos tu presencia digital para que cargue en un abrir y cerrar de ojos, funcione a la perfección en el móvil y convierta tu reputación en citas y ventas. Mira cómo quedaría tu sitio.`,

      dims: {
        lcp: {
          title: `Velocidad de carga`,
          unit: `primera vista en el móvil`,
          explain:
            tag.lcp === "ok"
              ? `Tu sitio muestra el contenido principal en <strong>${ctx.lcpDisp}</strong>, dentro de lo recomendado por Google. Es una ventaja: el cliente que entra no espera, y el impulso de compra que genera tu reputación se mantiene.`
              : `Tu sitio tarda <strong>${ctx.lcpDisp}</strong> en mostrar el contenido principal en el móvil. Google ha demostrado que, pasados los 3 segundos, más de la mitad de las personas abandona antes de que la página abra. En la práctica: tienes ${reviewsTxt} reseñas y una valoración de ${notaDisp} — clientes que llegan con ganas de comprar, entran en tu sitio y se topan con una pantalla aún en blanco. Hoy esta es probablemente la mayor fuga de oportunidades de tu negocio online.`,
        },
        tbt: {
          title: `Respuesta al toque`,
          unit: `tiempo bloqueado`,
          explain:
            tag.tbt === "ok"
              ? `Al tocar botones y desplazarte por la página, el sitio responde al instante. Esa fluidez transmite la misma confianza que ya transmiten tus reseñas.`
              : `Cuando el cliente intenta tocar un botón o desplazar la pantalla, el sitio se queda <strong>${ctx.tbtDisp}</strong> sin responder. Esa sensación de "bloqueado" da la impresión de un negocio frágil o desactualizado, justo lo contrario de la confianza que han ganado tus ${reviewsTxt} reseñas.`,
        },
        cls: {
          title: `Estabilidad visual`,
          unit: `desplazamiento del diseño`,
          explain:
            tag.cls === "ok"
              ? `Los elementos se mantienen firmes mientras carga la página. El cliente hace clic donde quiere, sin errores: una experiencia que no estorba la venta.`
              : `Mientras la página carga, los elementos "saltan" de lugar (índice ${ctx.clsDisp}). El cliente va a tocar "reservar" o "comprar" y acaba tocando otra cosa. Esa frustración, repetida, hace que mucha gente simplemente cierre el sitio.`,
        },
        seo: {
          title: `Aparecer en Google`,
          unit: `puntuación SEO /100`,
          explain:
            tag.seo === "ok"
              ? `Tu sitio está bien estructurado para Google. Eso te ayuda a aparecer también ante quien busca tu servicio, y no solo en Maps.`
              : `Tu SEO está en <strong>${ctx.seo}/100</strong>. Hoy dependes casi solo de Google Maps para que te encuentren. Un sitio bien estructurado capta también a quien escribe tu servicio en Google — clientes nuevos que, en este momento, van directos al competidor que aparece por delante.`,
        },
        a11y: {
          title: `Experiencia y accesibilidad`,
          unit: `accesibilidad /100`,
          explain:
            tag.a11y === "ok"
              ? `Tu sitio es fácil de leer y usar en cualquier pantalla. Como la mayoría de los clientes entra desde el móvil, eso juega mucho a tu favor.`
              : `La accesibilidad está en <strong>${ctx.a11y}/100</strong> — mide lo fácil que es leer y usar el sitio (contraste, tamaño del texto, navegación en el móvil). Buena parte de tus clientes te busca desde el móvil, muchas veces en la calle; los problemas aquí ahuyentan justo a quien está listo para comprar ahora.`,
        },
        bp: {
          title: `Confianza y seguridad`,
          unit: `buenas prácticas /100`,
          explain:
            tag.bp === "ok"
              ? `Tu sitio sigue los estándares modernos de seguridad y calidad. El candado de "sitio seguro" transmite credibilidad desde el primer segundo.`
              : `Las buenas prácticas están en <strong>${ctx.bp}/100</strong> — seguridad y estándares modernos (HTTPS, imágenes correctas, ausencia de errores). Un aviso de "sitio no seguro" o un fallo visible destruye, en segundos, la confianza que tu reputación tardó años en construir.`,
        },
      },
    };
  },
};
