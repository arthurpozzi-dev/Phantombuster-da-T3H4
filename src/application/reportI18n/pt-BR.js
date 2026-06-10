/**
 * Português (Brasil) — idioma padrão do relatório.
 *
 * `ctx` traz os valores já calculados/formatados pelo buildAuditReportModel:
 *   notaDisp, reviews, score10, band ("low"|"mid"|"high"), perdaEm10,
 *   lcpDisp, tbtDisp, clsDisp, perf, seo, a11y, bp (strings de exibição),
 *   tag: { lcp, tbt, cls, seo, a11y, bp } com "ok"|"warn"|"red".
 */
export default {
  htmlLang: "pt-BR",
  localeCode: "pt-BR",
  decimal: ",",

  files: {
    reportsDir: "relatorios",
    reportPrefix: "relatorio",
    list: {
      "com-site": { file: "com-site", label: "Com site" },
      "sem-site": { file: "sem-site", label: "Sem site" },
    },
  },

  cta: {
    type: "whatsapp",
    message: "Olá, vim pelo relatório, gostaria de ver a prévia do site que o time fez para mim!",
  },

  strings(ctx) {
    const { notaDisp, reviews, band, perdaEm10, score10, tag } = ctx;
    const reviewsTxt = reviews ? String(reviews) : "diversas";

    const resumo = {
      low: {
        r1: `Seu site está deixando dinheiro na mesa. A boa notícia é que o problema não é o seu negócio — é a vitrine digital, e isso tem conserto rápido.`,
        r2: `Sua nota ${notaDisp}★ com ${reviewsTxt} avaliações coloca você entre os mais bem avaliados da sua região. Mas quem clica no seu site encontra uma experiência que não combina com essa qualidade — e vai embora antes de comprar.`,
      },
      mid: {
        r1: `Seu site funciona, mas está longe do potencial. Há pontos claros que, ajustados, destravam conversões que hoje escapam.`,
        r2: `Com ${notaDisp}★ e ${reviewsTxt} avaliações, você atrai o cliente certo. Os ajustes abaixo garantem que ele não desista no meio do caminho.`,
      },
      high: {
        r1: `Seu site está num bom nível técnico — o que é raro. Ainda assim, há refinamentos que separam um site "bom" de um que vende no automático.`,
        r2: `Sua reputação (${notaDisp}★, ${reviewsTxt} avaliações) e um site sólido são uma combinação forte. Vamos potencializar o que já está bom.`,
      },
    }[band];

    return {
      reviewsFallback: "diversas",
      outOf10: `de 10`,
      tagline: `Auditoria de Presença Digital`,
      kickerAudit: `Auditoria`,
      footerPrefix: `Auditoria gerada em`,
      overall: `Resultado geral`,
      secRepVsSite: `Sua reputação vs. seu site`,
      whatBuilt: `O que você construiu`,
      googleRating: `Avaliação no Google`,
      numReviews: `Nº de avaliações`,
      reputation: `Reputação`,
      whatClientFinds: `O que o cliente encontra`,
      secDiagnosis: `Diagnóstico ponto a ponto`,
      secCost: `O que isso está custando`,
      conservativeEst: `Estimativa conservadora`,
      nextStep: `Próximo passo`,
      ctaRebuild: `Ver a versão reconstruída`,

      grade: { ok: `Bom`, warn: `Atenção`, red: `Crítico`, none: `Sem dado` },
      rank: {
        best: `Entre os melhores`,
        veryGood: `Muito bem avaliado`,
        good: `Bem avaliado`,
        rated: `Avaliado`,
      },
      contraste: {
        tempoCarregar: `Tempo até carregar`,
        notaPerf: `Nota de performance`,
        respInteragir: `Resposta ao interagir`,
      },

      subtitle: `Você construiu uma reputação que poucos concorrentes têm: ${notaDisp}★ com ${reviewsTxt} avaliações. Este relatório mostra, ponto a ponto, por que o seu site ainda não está transformando essa reputação em clientes — e o que muda quando ele estiver à altura do seu atendimento.`,
      resumo1: resumo.r1,
      resumo2: resumo.r2,

      impactoDestaque:
        score10 >= 8
          ? `Seu site preserva quase todos os clientes que sua reputação atrai — e ainda dá para subir essa régua.`
          : `A cada 10 clientes que abrem seu site vindos do Google, cerca de <strong style="color:var(--accent);">${perdaEm10}</strong> desistem antes de ver a sua oferta.`,
      impactoTexto: `Repare: não é falta de procura — sua reputação prova que a demanda existe. É a experiência do site que está barrando a venda no último passo. Recuperar essa fatia não exige gastar mais com anúncios; exige um site à altura do seu atendimento.`,

      proximoTitulo: `Seu site pode trabalhar tão bem quanto você atende.`,
      proximoTexto: `Reconstruímos a sua presença digital para carregar num piscar de olhos, funcionar perfeitamente no celular e transformar a sua reputação em agendamentos e vendas. Veja como o seu site ficaria.`,

      dims: {
        lcp: {
          title: `Velocidade de carregamento`,
          unit: `1ª tela no celular`,
          explain:
            tag.lcp === "ok"
              ? `Seu site mostra o conteúdo principal em <strong>${ctx.lcpDisp}</strong> — dentro do recomendado pelo Google. Isso é um trunfo: o cliente que clica não espera, e o impulso de compra gerado pela sua reputação é preservado.`
              : `Seu site leva <strong>${ctx.lcpDisp}</strong> para mostrar o conteúdo principal no celular. O Google comprovou que, passando de 3 segundos, mais da metade das pessoas desiste antes da página abrir. Na prática: você tem ${reviewsTxt} avaliações e nota ${notaDisp} — clientes que chegam querendo comprar, clicam no seu site e batem numa tela ainda em branco. Hoje, esse é provavelmente o maior ralo de oportunidades do seu negócio online.`,
        },
        tbt: {
          title: `Resposta ao toque`,
          unit: `tempo travado`,
          explain:
            tag.tbt === "ok"
              ? `Ao tocar em botões e rolar a página, o site responde na hora. Essa fluidez transmite a mesma confiança que as suas avaliações já passam.`
              : `Quando o cliente tenta tocar num botão ou rolar a tela, o site fica <strong>${ctx.tbtDisp}</strong> sem responder. Essa sensação de "travado" passa a impressão de um negócio frágil ou desatualizado — exatamente o oposto da confiança que as suas ${reviewsTxt} avaliações conquistaram.`,
        },
        cls: {
          title: `Estabilidade visual`,
          unit: `deslocamento de layout`,
          explain:
            tag.cls === "ok"
              ? `Os elementos ficam firmes enquanto a página carrega. O cliente clica onde quer, sem erros — uma experiência que não atrapalha a venda.`
              : `Enquanto a página carrega, os elementos "pulam" de lugar (índice ${ctx.clsDisp}). O cliente vai clicar em "agendar" ou "comprar" e acaba clicando em outra coisa. Essa frustração, repetida, faz muita gente simplesmente fechar o site.`,
        },
        seo: {
          title: `Ser encontrado no Google`,
          unit: `score de SEO /100`,
          explain:
            tag.seo === "ok"
              ? `Seu site está bem estruturado para o Google. Isso ajuda você a aparecer também para quem pesquisa pelo seu serviço, e não só no Maps.`
              : `Seu SEO está em <strong>${ctx.seo}/100</strong>. Hoje você depende quase só do Google Maps para ser achado. Um site bem estruturado captura também quem digita o seu serviço no Google — clientes novos que, neste momento, vão direto para o concorrente que aparece na frente.`,
        },
        a11y: {
          title: `Experiência e acessibilidade`,
          unit: `acessibilidade /100`,
          explain:
            tag.a11y === "ok"
              ? `Seu site é fácil de ler e usar em qualquer tela. Como a maioria dos clientes acessa pelo celular, isso conta muito a seu favor.`
              : `A acessibilidade está em <strong>${ctx.a11y}/100</strong> — mede o quão fácil é ler e usar o site (contraste, tamanho de texto, navegação no celular). Boa parte dos seus clientes te procura pelo celular, muitas vezes na rua; problemas aqui afastam justamente quem está pronto para comprar agora.`,
        },
        bp: {
          title: `Confiança e segurança`,
          unit: `boas práticas /100`,
          explain:
            tag.bp === "ok"
              ? `Seu site segue os padrões modernos de segurança e qualidade. O cadeado de "site seguro" passa credibilidade já no primeiro segundo.`
              : `As boas práticas estão em <strong>${ctx.bp}/100</strong> — segurança e padrões modernos (HTTPS, imagens corretas, ausência de erros). Um aviso de "site não seguro" ou uma falha visível destrói, em segundos, a confiança que a sua reputação levou anos para construir.`,
        },
      },
    };
  },
};
