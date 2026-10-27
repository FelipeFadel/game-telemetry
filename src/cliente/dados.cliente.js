// Roda no navegador, dentro de /dados. Importado como texto pelo Worker.
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const form = $("#filtros");
  const selecionados = new Set();
  let pagina = 1;
  let total = 0;
  let porPagina = 100;
  let linhasAtuais = [];
  let opcoes = { tiposValidos: [] };
  let editando = null;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const quando = (ms) => ms ? new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }) : "";

  function filtroAtual() {
    const f = {};
    for (const [k, v] of new FormData(form)) if (v) f[k] = v;
    return f;
  }

  async function chamar(caminho, corpo) {
    const r = await fetch(caminho, corpo === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}`);
    return dados;
  }

  function avisar(texto, lote) {
    const el = $("#aviso");
    el.innerHTML = `<span>${esc(texto)}</span>` + (lote ? '<button type="button">Desfazer</button>' : "");
    el.hidden = false;
    if (lote) {
      el.querySelector("button").onclick = async () => {
        await desfazer(lote);
        el.hidden = true;
      };
    }
    clearTimeout(avisar.timer);
    avisar.timer = setTimeout(() => { el.hidden = true; }, 10000);
  }

  // --- Opções dos filtros ---

  async function carregarOpcoes() {
    opcoes = await chamar("/api/opcoes");
    const preencher = (nome, todos, itens) => {
      const sel = form.elements[nome];
      const atual = sel.value;
      sel.innerHTML = `<option value="">${todos}</option>` + itens.map((i) => `<option value="${esc(i.v)}">${esc(i.t)}</option>`).join("");
      sel.value = atual;
    };
    preencher("turma", "Todas", opcoes.turmas.map((t) => ({ v: t.turma, t: `${t.turma} (${t.n})` })));
    preencher("tipo", "Todos", opcoes.tipos.map((t) => ({ v: t.tipo, t: `${t.tipo} (${t.n})` })));
    preencher("fase", "Todas", opcoes.fases.map((f) => ({ v: f.fase, t: `${f.fase} (${f.n})` })));
    $("#lista-alunos").innerHTML = opcoes.alunos.map((a) => `<option value="${esc(a.nome)}">${a.n} registros</option>`).join("");
    $("#form-editor").elements.tipo.innerHTML = opcoes.tiposValidos.map((t) => `<option>${esc(t)}</option>`).join("");
  }

  // --- Tabela ---

  async function carregar() {
    const q = new URLSearchParams({ ...filtroAtual(), pagina });
    const dados = await chamar("/api/registros?" + q);
    total = dados.total;
    porPagina = dados.porPagina;
    linhasAtuais = dados.linhas;

    const paginas = Math.max(1, Math.ceil(total / porPagina));
    $("#resumo").textContent = `${total.toLocaleString("pt-BR")} registros`;
    $("#n-filtro").textContent = total.toLocaleString("pt-BR");
    $("#pagina").textContent = `Página ${pagina} de ${paginas}`;
    $("#anterior").disabled = pagina <= 1;
    $("#proxima").disabled = pagina >= paginas;

    $("#tabela tbody").innerHTML = linhasAtuais.map((l) => `<tr data-id="${esc(l.id)}"${selecionados.has(l.id) ? ' class="marcada"' : ""}>
      <td><input type="checkbox" aria-label="Selecionar"${selecionados.has(l.id) ? " checked" : ""}></td>
      <td title="Recebido: ${esc(quando(l.criado_em))}${l.cliente_em ? " · No aparelho: " + esc(quando(l.cliente_em)) : ""}">${esc(quando(l.cliente_em || l.criado_em))}</td>
      <td>${esc(l.turma)}</td>
      <td>${esc(l.aluno_nome)}</td>
      <td><span class="etiqueta">${esc(l.tipo)}</span></td>
      <td>${esc(l.fase ?? "")}</td>
      <td class="num">${l.acertos ?? ""}</td>
      <td class="num">${l.erros ?? ""}</td>
      <td class="num">${l.duracao_s ?? ""}</td>
      <td>${l.teste ? "✓ teste" : ""}</td>
      <td class="dados" title="${l.dados_tam ? l.dados_tam + " caracteres" : ""}">${esc(l.dados_inicio ?? "")}</td>
      <td><button type="button" class="editar" aria-label="Editar">✎</button></td>
    </tr>`).join("") || `<tr><td colspan="12" class="vazio">Nenhum registro com esse filtro.</td></tr>`;

    $("#marcar-pagina").checked = linhasAtuais.length > 0 && linhasAtuais.every((l) => selecionados.has(l.id));
    atualizarSelecao();
  }

  function atualizarSelecao() {
    $("#acoes-selecao").hidden = selecionados.size === 0;
    $("#n-selecionados").textContent = `${selecionados.size} selecionado${selecionados.size > 1 ? "s" : ""}:`;
  }

  $("#tabela tbody").addEventListener("change", (e) => {
    const tr = e.target.closest("tr");
    if (!tr || e.target.type !== "checkbox") return;
    if (e.target.checked) selecionados.add(tr.dataset.id); else selecionados.delete(tr.dataset.id);
    tr.classList.toggle("marcada", e.target.checked);
    atualizarSelecao();
  });

  $("#marcar-pagina").addEventListener("change", (e) => {
    for (const l of linhasAtuais) if (e.target.checked) selecionados.add(l.id); else selecionados.delete(l.id);
    carregar();
  });

  $("#tabela tbody").addEventListener("click", (e) => {
    if (e.target.classList.contains("editar")) abrirEditor(e.target.closest("tr").dataset.id);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    pagina = 1;
    selecionados.clear();
    carregar();
  });
  $("#limpar").addEventListener("click", () => {
    form.reset();
    pagina = 1;
    selecionados.clear();
    carregar();
  });
  $("#anterior").addEventListener("click", () => { pagina--; carregar(); });
  $("#proxima").addEventListener("click", () => { pagina++; carregar(); });

  // --- Ações em massa ---

  // Monta {acao, campos, descricao} a partir do botão; null = cancelado.
  function pedirAcao(tipo, quantos) {
    const n = `${quantos} registro${quantos > 1 ? "s" : ""}`;
    switch (tipo) {
      case "apagar":
        return confirm(`Apagar ${n}? Dá para desfazer pelo Histórico.`) ? { acao: "apagar", descricao: `Apagou ${n}` } : null;
      case "teste":
        return { acao: "atualizar", campos: { teste: 1 }, descricao: `Marcou ${n} como teste` };
      case "nao-teste":
        return { acao: "atualizar", campos: { teste: 0 }, descricao: `Desmarcou teste em ${n}` };
      case "turma": {
        const turma = prompt(`Mover ${n} para qual turma?`);
        return turma ? { acao: "atualizar", campos: { turma }, descricao: `Moveu ${n} para a turma ${turma.toUpperCase()}` } : null;
      }
      case "nome": {
        const nome = prompt(`Novo nome do aluno para ${n}?\nSe já existir um aluno com esse nome, os registros passam a ser dele.`);
        return nome ? { acao: "atualizar", campos: { aluno_nome: nome }, descricao: `Renomeou ${n} para ${nome}` } : null;
      }
    }
    return null;
  }

  async function executar(alvo, pedido) {
    try {
      const r = await chamar("/api/alterar", { ...alvo, ...pedido });
      avisar(`${pedido.descricao}: ${r.afetados} alterado(s).`, r.lote);
      selecionados.clear();
      await carregarOpcoes();
      await carregar();
    } catch (err) {
      alert(err.message);
    }
  }

  $$("[data-acao]").forEach((b) => b.addEventListener("click", () => {
    const pedido = pedirAcao(b.dataset.acao, selecionados.size);
    if (pedido) executar({ ids: [...selecionados] }, pedido);
  }));

  $$("[data-acao-filtro]").forEach((b) => b.addEventListener("click", () => {
    const filtro = filtroAtual();
    const temFiltro = Object.keys(filtro).some((k) => k !== "testes");
    if (!temFiltro) return alert("Escolha pelo menos um filtro (turma, aluno, tipo, fase, sessão ou datas).");
    const pedido = pedirAcao(b.dataset.acaoFiltro, total);
    if (pedido) executar({ filtro }, pedido);
  }));

  // --- Editor de um registro ---

  const editor = $("#editor");
  const fe = $("#form-editor");

  async function abrirEditor(id) {
    const r = await chamar("/api/registro?id=" + encodeURIComponent(id));
    editando = r;
    for (const c of ["aluno_nome", "turma", "tipo", "fase", "acertos", "erros", "duracao_s"]) fe.elements[c].value = r[c] ?? "";
    fe.elements.teste.checked = !!r.teste;
    fe.elements.dados.value = r.dados ? JSON.stringify(JSON.parse(r.dados), null, 2) : "";
    $("#editor-info").textContent = `id ${r.id} · sessão ${r.sessao} · recebido ${quando(r.criado_em)}`;
    $("#editor-erro").textContent = "";
    editor.showModal();
  }

  fe.addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "salvar") return;
    e.preventDefault();

    // Só manda o que mudou.
    const campos = {};
    for (const c of ["aluno_nome", "turma", "tipo", "fase", "acertos", "erros", "duracao_s"]) {
      const v = fe.elements[c].value;
      if (String(editando[c] ?? "") !== v) campos[c] = v;
    }
    if (!!editando.teste !== fe.elements.teste.checked) campos.teste = fe.elements.teste.checked ? 1 : 0;

    const textoDados = fe.elements.dados.value.trim();
    const original = editando.dados ? JSON.stringify(JSON.parse(editando.dados)) : "";
    let novo = "";
    if (textoDados) {
      try {
        novo = JSON.stringify(JSON.parse(textoDados));
      } catch {
        $("#editor-erro").textContent = "Os dados não são um JSON válido.";
        return;
      }
    }
    if (novo !== original) campos.dados = novo || null;

    if (Object.keys(campos).length === 0) { editor.close(); return; }
    try {
      const r = await chamar("/api/alterar", { ids: [editando.id], acao: "atualizar", campos, descricao: `Editou um registro de ${editando.aluno_nome}` });
      editor.close();
      avisar("Registro salvo.", r.lote);
      await carregarOpcoes();
      await carregar();
    } catch (err) {
      $("#editor-erro").textContent = err.message;
    }
  });

  // --- Histórico ---

  async function carregarHistorico() {
    const linhas = await chamar("/api/historico");
    $("#historico tbody").innerHTML = linhas.map((h) => `<tr>
      <td>${esc(quando(h.feito_em))}</td>
      <td>${esc(h.descricao || h.acao)}</td>
      <td class="num">${h.n}</td>
      <td>${esc(h.alunos || "")}</td>
      <td>${h.desfeito_em ? `<span class="nota">desfeito em ${esc(quando(h.desfeito_em))}</span>` : `<button type="button" data-lote="${esc(h.lote)}">Desfazer</button>`}</td>
    </tr>`).join("") || '<tr><td colspan="5" class="vazio">Nenhuma alteração ainda.</td></tr>';
  }

  async function desfazer(lote) {
    try {
      const r = await chamar("/api/desfazer", { lote });
      avisar(`Desfeito: ${r.restaurados} registro(s) restaurado(s).`);
      await carregarOpcoes();
      await carregar();
      if (!$("#aba-historico").hidden) await carregarHistorico();
    } catch (err) {
      alert(err.message);
    }
  }

  $("#historico tbody").addEventListener("click", (e) => {
    const lote = e.target.dataset?.lote;
    if (lote && confirm("Desfazer essa alteração?")) desfazer(lote);
  });

  $$("[data-aba]").forEach((b) => b.addEventListener("click", () => {
    $$("[data-aba]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $("#aba-registros").hidden = b.dataset.aba !== "registros";
    $("#aba-historico").hidden = b.dataset.aba !== "historico";
    if (b.dataset.aba === "historico") carregarHistorico();
  }));

  carregarOpcoes().then(carregar).catch((err) => {
    $("#resumo").textContent = "Erro ao carregar: " + err.message;
  });
})();
