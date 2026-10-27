// Roda no navegador, dentro de /heatmap. Importado como texto pelo Worker.
(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const base = new URLSearchParams();
  for (const k of ["turma", "testes"]) if (params.get(k)) base.set(k, params.get(k));

  const estilo = getComputedStyle(document.documentElement);
  const cor = (nome) => estilo.getPropertyValue(nome).trim();
  // Rampa sequencial de um tom (claro = pouco, escuro = muito).
  const RAMPA = ["--seq-100", "--seq-200", "--seq-300", "--seq-400", "--seq-500", "--seq-600", "--seq-700"].map(cor).map(hexParaRgb);

  let contextos = [];
  let pontos = [];
  let capturas = new Map(); // nome do arquivo -> File
  let imagemAvulsa = null;
  let fundo = null;         // HTMLImageElement do print atual
  let desenhados = [];      // pontos em pixels, para a dica

  // Mesmo nome que o TelemetriaEntrada.NomeCaptura gera no Unity.
  const nomeCaptura = (ctx) => ctx.replace(/[^A-Za-z0-9_+-]/g, "_") + "__";

  function hexParaRgb(h) {
    const n = parseInt(h.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  async function api(extra) {
    const q = new URLSearchParams(base);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const r = await fetch("/api/heatmap?" + q);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  function opcoes(select, itens, atual) {
    select.innerHTML = itens.map(([v, t]) => `<option value="${esc(v)}"${v === atual ? " selected" : ""}>${esc(t)}</option>`).join("");
  }

  function salvarUrl() {
    const q = new URLSearchParams(base);
    for (const id of ["cena", "ctx", "aluno"]) if ($(id).value) q.set(id, $(id).value);
    history.replaceState(null, "", "?" + q);
  }

  async function carregarLista() {
    const dados = await api({ aluno: $("aluno").value });
    contextos = dados.contextos;
    opcoes($("aluno"), [["", "Todos"], ...dados.alunos.map((a) => [a.aluno, a.nome])], $("aluno").value || params.get("aluno") || "");

    const cenas = new Map();
    for (const c of contextos) {
      const cena = c.ctx.split("|")[0];
      cenas.set(cena, (cenas.get(cena) || 0) + c.n);
    }
    const cenaAtual = $("cena").value || params.get("cena") || "";
    opcoes($("cena"), [...cenas].map(([c, n]) => [c, `${c} (${n})`]), cenas.has(cenaAtual) ? cenaAtual : [...cenas.keys()][0]);
    if (contextos.length === 0) {
      $("avisos").innerHTML = '<p class="aviso">Ainda não há cliques registrados para este filtro.</p>';
    }
    preencherContextos(params.get("ctx"));
  }

  function preencherContextos(preferido) {
    const cena = $("cena").value;
    const daCena = contextos.filter((c) => c.ctx.split("|")[0] === cena);
    const rotulo = (c) => {
      const partes = c.ctx.split("|");
      const paineis = partes[2] ? partes[2].split("+").join(", ") : "sem painéis";
      return `${partes[1]} · ${paineis} (${c.n} cliques, ${c.alunos} alunos)`;
    };
    const atual = daCena.some((c) => c.ctx === preferido) ? preferido : daCena[0]?.ctx;
    opcoes($("ctx"), daCena.map((c) => [c.ctx, rotulo(c)]), atual);
    carregarPontos();
  }

  async function carregarPontos() {
    salvarUrl();
    const ctx = $("ctx").value;
    pontos = [];
    if (ctx) {
      const dados = await api({ ctx, aluno: $("aluno").value });
      pontos = dados.pontos;
      $("avisos").innerHTML = dados.cortado ? '<p class="aviso">Muitos cliques: mostrando só os primeiros 20 mil.</p>' : "";
    }

    // Resolução mais comum primeiro.
    const contagem = new Map();
    for (const p of pontos) contagem.set(p[2], (contagem.get(p[2]) || 0) + 1);
    const resolucoes = [...contagem].sort((a, b) => b[1] - a[1]);
    opcoes($("res"), [["", "Todas"], ...resolucoes.map(([r, n]) => [r, `${r} (${n})`])], resolucoes[0]?.[0] || "");

    escolherFundo();
  }

  function escolherFundo() {
    const ctx = $("ctx").value;
    const res = $("res").value;
    let arquivo = imagemAvulsa;
    if (!arquivo && ctx && capturas.size) {
      const prefixo = nomeCaptura(ctx);
      const candidatos = [...capturas.keys()].filter((n) => n.startsWith(prefixo));
      const exato = candidatos.find((n) => n === `${prefixo}${res}.png`);
      arquivo = capturas.get(exato || candidatos[0]);
    }

    $("statusFundo").textContent = imagemAvulsa ? "Usando a imagem escolhida."
      : !capturas.size ? "Sem print de fundo: escolha a pasta de capturas."
      : arquivo ? `Print: ${arquivo.name}` : "Não há print desta tela na pasta.";

    if (!arquivo) { fundo = null; desenhar(); return; }
    const img = new Image();
    img.onload = () => { fundo = img; desenhar(); };
    img.src = URL.createObjectURL(arquivo);
  }

  function filtrados() {
    const res = $("res").value;
    return res ? pontos.filter((p) => p[2] === res) : pontos;
  }

  function desenhar() {
    const lista = filtrados();
    const res = $("res").value || lista[0]?.[2] || "16x9";
    const [rw, rh] = res.split("x").map(Number);
    const canvas = $("canvas");
    const largura = Math.min(1200, $("tela").clientWidth || 800);
    const altura = Math.round(largura * (rh / rw));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.fillStyle = cor("--superficie");
    g.fillRect(0, 0, largura, altura);
    let avisoProporcao = "";
    if (fundo) {
      g.globalAlpha = $("fundo").value / 100;
      g.drawImage(fundo, 0, 0, largura, altura);
      g.globalAlpha = 1;
      const proporcaoImg = fundo.naturalWidth / fundo.naturalHeight;
      if (Math.abs(proporcaoImg - rw / rh) > 0.02) {
        avisoProporcao = `<p class="aviso">O print (${fundo.naturalWidth}x${fundo.naturalHeight}) tem proporção diferente dos cliques (${esc(res)}); as posições não vão bater.</p>`;
      }
    }
    $("avisoProporcao").innerHTML = avisoProporcao;

    desenhados = lista.map((p) => ({ x: p[0] * largura, y: p[1] * altura, alvo: p[3], ui: p[4] }));
    if ($("modo").value === "calor") desenharCalor(g, largura, altura, dpr);
    else desenharPontos(g);

    atualizarResumo(lista);
    atualizarLegenda();
  }

  function desenharCalor(g, largura, altura, dpr) {
    if (desenhados.length === 0) return;
    // 1) acumula densidade num canvas só de alfa; 2) pinta com a rampa.
    const w = Math.round(largura * dpr), h = Math.round(altura * dpr);
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const o = off.getContext("2d");
    const raio = Math.max(14, largura * 0.035) * dpr;
    const alfa = Math.max(0.04, Math.min(0.35, 6 / desenhados.length + 0.05));
    for (const p of desenhados) {
      const gr = o.createRadialGradient(p.x * dpr, p.y * dpr, 0, p.x * dpr, p.y * dpr, raio);
      gr.addColorStop(0, `rgba(0,0,0,${alfa})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      o.fillStyle = gr;
      o.fillRect(p.x * dpr - raio, p.y * dpr - raio, raio * 2, raio * 2);
    }
    const img = o.getImageData(0, 0, w, h);
    const d = img.data;
    let max = 1;
    for (let i = 3; i < d.length; i += 4) if (d[i] > max) max = d[i];
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i + 3] / max;
      if (v < 0.02) { d[i + 3] = 0; continue; }
      const pos = v * (RAMPA.length - 1);
      const a = RAMPA[Math.floor(pos)], b = RAMPA[Math.min(RAMPA.length - 1, Math.floor(pos) + 1)];
      const t = pos - Math.floor(pos);
      d[i] = a[0] + (b[0] - a[0]) * t;
      d[i + 1] = a[1] + (b[1] - a[1]) * t;
      d[i + 2] = a[2] + (b[2] - a[2]) * t;
      d[i + 3] = Math.round(255 * Math.min(0.9, 0.35 + v * 0.6));
    }
    o.putImageData(img, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(off, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function desenharPontos(g) {
    const anel = cor("--superficie");
    for (const p of desenhados) {
      g.beginPath();
      g.arc(p.x, p.y, 5, 0, Math.PI * 2);
      g.fillStyle = p.ui ? cor("--bom") : cor("--critico");
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = anel;
      g.stroke();
    }
  }

  function atualizarResumo(lista) {
    const total = lista.length;
    const vazios = lista.filter((p) => !p[4]).length;
    $("total").textContent = total.toLocaleString("pt-BR");
    $("vazios").textContent = total ? `${Math.round((vazios / total) * 100)}%` : "—";

    const porAlvo = new Map();
    for (const p of lista) {
      const chave = p[3] || "(nenhum elemento de UI)";
      const atual = porAlvo.get(chave) || { n: 0, ui: p[4] };
      atual.n++;
      porAlvo.set(chave, atual);
    }
    const linhas = [...porAlvo].sort((a, b) => b[1].n - a[1].n);
    const maior = linhas[0]?.[1].n || 1;
    $("alvos").tBodies[0].innerHTML = linhas.map(([alvo, v]) => `<tr>
      <td>${v.ui ? "" : "⚠ "}${esc(alvo)}<span class="barra" style="width:${Math.max(4, (v.n / maior) * 100)}%"></span></td>
      <td class="num">${v.n}</td><td class="num">${Math.round((v.n / total) * 100)}%</td></tr>`).join("")
      || '<tr><td colspan="3" class="vazio">Sem cliques.</td></tr>';
  }

  function atualizarLegenda() {
    $("legenda").innerHTML = $("modo").value === "calor"
      ? `<span>menos cliques <span class="rampa" aria-hidden="true"></span> mais cliques</span><span>Passe o mouse para ver os elementos.</span>`
      : `<span><span class="marca" style="background:${cor("--bom")}"></span>✓ clicou num botão ou campo</span>
         <span><span class="marca" style="background:${cor("--critico")}"></span>⚠ clicou fora de qualquer botão</span>`;
  }

  // Dica ao passar o mouse: quantos cliques perto e em quê.
  $("canvas").addEventListener("mousemove", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const perto = desenhados.filter((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 24 ** 2);
    const dica = $("dica");
    if (perto.length === 0) { dica.hidden = true; return; }
    const alvos = new Map();
    for (const p of perto) alvos.set(p.alvo || "(nenhum elemento)", (alvos.get(p.alvo || "(nenhum elemento)") || 0) + 1);
    const top = [...alvos].sort((a, b) => b[1] - a[1]).slice(0, 3);
    dica.innerHTML = `<b>${perto.length} clique${perto.length > 1 ? "s" : ""} aqui</b><br>` +
      top.map(([a, n]) => `${esc(a)}: ${n}`).join("<br>");
    dica.hidden = false;
    dica.style.left = Math.min(x + 14, r.width - 270) + "px";
    dica.style.top = Math.min(y + 14, r.height - 80) + "px";
  });
  $("canvas").addEventListener("mouseleave", () => { $("dica").hidden = true; });

  $("cena").addEventListener("change", () => preencherContextos(null));
  $("ctx").addEventListener("change", carregarPontos);
  $("aluno").addEventListener("change", carregarLista);
  $("res").addEventListener("change", escolherFundo);
  $("modo").addEventListener("change", desenhar);
  $("fundo").addEventListener("input", desenhar);
  $("pasta").addEventListener("change", (e) => {
    capturas = new Map([...e.target.files].map((f) => [f.name, f]));
    imagemAvulsa = null;
    escolherFundo();
  });
  $("imagem").addEventListener("change", (e) => {
    imagemAvulsa = e.target.files[0] || null;
    escolherFundo();
  });
  window.addEventListener("resize", () => desenhar());

  carregarLista().catch((err) => {
    $("avisos").innerHTML = `<p class="aviso">Erro ao carregar: ${esc(err.message)}</p>`;
  });
})();
