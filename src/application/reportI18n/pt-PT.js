/**
 * Português (Portugal). Ver pt-BR.js para o formato de `ctx`.
 * Usa convenções europeias: telemóvel, ecrã, "a + infinitivo" em vez de gerúndio,
 * marcações, etc.
 */
export default {
  htmlLang: "pt-PT",
  localeCode: "pt-PT",
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
    message:
      "Olá, vim através do relatório e gostaria de ver a pré-visualização do site que a equipa criou para mim!",
  },

  strings(ctx) {
    const { notaDisp, reviews, band, perdaEm10, score10, tag } = ctx;
    const reviewsTxt = reviews ? String(reviews) : "diversas";

    const resumo = {
      low: {
        r1: `O seu site está a deixar dinheiro em cima da mesa. A boa notícia é que o problema não é o seu negócio — é a montra digital, e isso tem solução rápida.`,
        r2: `A sua nota de ${notaDisp}★ com ${reviewsTxt} avaliações coloca-o entre os mais bem avaliados da sua região. Mas quem clica no seu site encontra uma experiência que não condiz com essa qualidade — e vai-se embora antes de comprar.`,
      },
      mid: {
        r1: `O seu site funciona, mas está longe do seu potencial. Há pontos claros que, depois de corrigidos, desbloqueiam conversões que hoje lhe escapam.`,
        r2: `Com ${notaDisp}★ e ${reviewsTxt} avaliações, atrai o cliente certo. Os ajustes abaixo garantem que ele não desiste a meio do caminho.`,
      },
      high: {
        r1: `O seu site está num bom nível técnico — o que é raro. Ainda assim, há refinamentos que distinguem um site "bom" de um que vende em piloto automático.`,
        r2: `A sua reputação (${notaDisp}★, ${reviewsTxt} avaliações) e um site sólido são uma combinação forte. Vamos potenciar o que já está bom.`,
      },
    }[band];

    return {
      reviewsFallback: "diversas",
      outOf10: `em 10`,
      tagline: `Auditoria de Presença Digital`,
      kickerAudit: `Auditoria`,
      footerPrefix: `Auditoria gerada a`,
      overall: `Resultado geral`,
      secRepVsSite: `A sua reputação vs. o seu site`,
      whatBuilt: `O que construiu`,
      googleRating: `Avaliação no Google`,
      numReviews: `N.º de avaliações`,
      reputation: `Reputação`,
      whatClientFinds: `O que o cliente encontra`,
      secDiagnosis: `Diagnóstico ponto a ponto`,
      secCost: `O que isto lhe está a custar`,
      conservativeEst: `Estimativa conservadora`,
      nextStep: `Próximo passo`,
      ctaRebuild: `Ver a versão reconstruída`,

      grade: { ok: `Bom`, warn: `Atenção`, red: `Crítico`, none: `Sem dados` },
      rank: {
        best: `Entre os melhores`,
        veryGood: `Muito bem avaliado`,
        good: `Bem avaliado`,
        rated: `Avaliado`,
      },
      contraste: {
        tempoCarregar: `Tempo até carregar`,
        notaPerf: `Nota de desempenho`,
        respInteragir: `Resposta ao interagir`,
      },

      subtitle: `Construiu uma reputação que poucos concorrentes têm: ${notaDisp}★ com ${reviewsTxt} avaliações. Este relatório mostra, ponto a ponto, porque é que o seu site ainda não está a transformar essa reputação em clientes — e o que muda quando ele estiver à altura do seu atendimento.`,
      resumo1: resumo.r1,
      resumo2: resumo.r2,

      impactoDestaque:
        score10 >= 8
          ? `O seu site preserva quase todos os clientes que a sua reputação atrai — e ainda dá para subir essa fasquia.`
          : `Em cada 10 clientes que abrem o seu site vindos do Google, cerca de <strong style="color:var(--accent);">${perdaEm10}</strong> desistem antes de ver a sua oferta.`,
      impactoTexto: `Repare: não é falta de procura — a sua reputação prova que a procura existe. É a experiência do site que está a travar a venda no último passo. Recuperar essa fatia não exige gastar mais em publicidade; exige um site à altura do seu atendimento.`,

      proximoTitulo: `O seu site pode trabalhar tão bem como você atende.`,
      proximoTexto: `Reconstruímos a sua presença digital para carregar num abrir e fechar de olhos, funcionar na perfeição no telemóvel e transformar a sua reputação em marcações e vendas. Veja como ficaria o seu site.`,

      dims: {
        lcp: {
          title: `Velocidade de carregamento`,
          unit: `1.º ecrã no telemóvel`,
          explain:
            tag.lcp === "ok"
              ? `O seu site mostra o conteúdo principal em <strong>${ctx.lcpDisp}</strong> — dentro do recomendado pelo Google. Isto é um trunfo: o cliente que clica não espera, e o impulso de compra gerado pela sua reputação é preservado.`
              : `O seu site demora <strong>${ctx.lcpDisp}</strong> a mostrar o conteúdo principal no telemóvel. O Google comprovou que, passados 3 segundos, mais de metade das pessoas desiste antes de a página abrir. Na prática: tem ${reviewsTxt} avaliações e nota ${notaDisp} — clientes que chegam a querer comprar, clicam no seu site e deparam-se com um ecrã ainda em branco. Hoje, esta é provavelmente a maior fuga de oportunidades do seu negócio online.`,
        },
        tbt: {
          title: `Resposta ao toque`,
          unit: `tempo bloqueado`,
          explain:
            tag.tbt === "ok"
              ? `Ao tocar em botões e percorrer a página, o site responde de imediato. Essa fluidez transmite a mesma confiança que as suas avaliações já passam.`
              : `Quando o cliente tenta tocar num botão ou percorrer o ecrã, o site fica <strong>${ctx.tbtDisp}</strong> sem responder. Essa sensação de "bloqueado" passa a impressão de um negócio frágil ou desatualizado — exatamente o oposto da confiança que as suas ${reviewsTxt} avaliações conquistaram.`,
        },
        cls: {
          title: `Estabilidade visual`,
          unit: `deslocamento do layout`,
          explain:
            tag.cls === "ok"
              ? `Os elementos mantêm-se firmes enquanto a página carrega. O cliente clica onde quer, sem erros — uma experiência que não atrapalha a venda.`
              : `Enquanto a página carrega, os elementos "saltam" de lugar (índice ${ctx.clsDisp}). O cliente vai clicar em "marcar" ou "comprar" e acaba por clicar noutra coisa. Essa frustração, repetida, leva muita gente a simplesmente fechar o site.`,
        },
        seo: {
          title: `Ser encontrado no Google`,
          unit: `score de SEO /100`,
          explain:
            tag.seo === "ok"
              ? `O seu site está bem estruturado para o Google. Isso ajuda-o a aparecer também para quem pesquisa pelo seu serviço, e não só no Maps.`
              : `O seu SEO está em <strong>${ctx.seo}/100</strong>. Hoje depende quase só do Google Maps para ser encontrado. Um site bem estruturado capta também quem escreve o seu serviço no Google — clientes novos que, neste momento, vão direitos ao concorrente que aparece à frente.`,
        },
        a11y: {
          title: `Experiência e acessibilidade`,
          unit: `acessibilidade /100`,
          explain:
            tag.a11y === "ok"
              ? `O seu site é fácil de ler e usar em qualquer ecrã. Como a maioria dos clientes acede pelo telemóvel, isso conta muito a seu favor.`
              : `A acessibilidade está em <strong>${ctx.a11y}/100</strong> — mede o quão fácil é ler e usar o site (contraste, tamanho do texto, navegação no telemóvel). Boa parte dos seus clientes procura-o pelo telemóvel, muitas vezes na rua; problemas aqui afastam justamente quem está pronto a comprar agora.`,
        },
        bp: {
          title: `Confiança e segurança`,
          unit: `boas práticas /100`,
          explain:
            tag.bp === "ok"
              ? `O seu site segue os padrões modernos de segurança e qualidade. O cadeado de "site seguro" passa credibilidade logo no primeiro segundo.`
              : `As boas práticas estão em <strong>${ctx.bp}/100</strong> — segurança e padrões modernos (HTTPS, imagens corretas, ausência de erros). Um aviso de "site não seguro" ou uma falha visível destrói, em segundos, a confiança que a sua reputação levou anos a construir.`,
        },
      },
    };
  },
};
