# Gaslight Archive (@GaslightArchive) — Playbook do Trevor

Canal faceless de **Dark History** em **inglês** (mercado EUA/UK): tragédias, desastres e mistérios reais de **antes de ~1929** (imagens de arquivo em domínio público + IA só onde não há registro).
Modelo: **Fascinating Horror** (análise completa em `referencias/fascinating-horror-human-cannonball.md`). Ritmo: **2 vídeos novos + 1 compilação por semana** (seg/qua/sex 15:00 UTC). Meta: vídeos com 1M+ views.
O Trevor (Claude Code) é o produtor: pesquisa, roteiro, voz e imagens via Higgsfield MCP. O estúdio local (Node) monta, publica e mostra tudo no painel.

## Comandos

```bash
npm run painel                      # painel em http://localhost:4400
npm run cli -- idea "Title" --angle "..."   # nova pauta
npm run cli -- status <slug> <status> --note "..."
npm run cli -- credits <slug> <valor> <image|voice|thumb|video>
npm run cli -- render <slug>        # monta final.mp4 + captions.srt + chapters.json
npm run cli -- schedule <slug> [ISO] # sem data = próximo slot livre
npm run cli -- upload <slug>        # sobe privado + agendado, thumbnail, legenda
npm run cli -- stats                # sincroniza views/inscritos
npm run cli -- list
```

Status em ordem: `idea → approved → scripting → script_review → producing → rendering → final_review → scheduled → published` (+ `rejected`).
**Portões humanos**: `idea`, `script_review` e `final_review` só avançam com aprovação do usuário (painel ou chat). Nunca pule um portão.

## Por que os portões existem
Desde jan/2026 o YouTube encerra em massa canais de IA "inauthentic" (template + voz sintética + volume). Faceless e voz de IA são permitidos **se cada vídeo tem pesquisa e ângulo próprios**. Então: cada roteiro precisa de fontes reais, um ângulo/tese própria, e variação de estrutura entre vídeos. Sempre marcar `containsSyntheticMedia: true` (já feito no upload).

## Estrutura de pastas por vídeo — `videos/<slug>/`
```
research.md     fontes (com URLs), fatos verificados, mitos a desmentir, ângulo
script.md       roteiro final (narração pura, em inglês)
scenes.json     cenas: texto + imagem + áudio + movimento (+ chapter)
images/NN.png   16:9
audio/NN.mp3    1 arquivo por cena
seo.json        title, description, tags, hashtags, categoryId
thumbnail.jpg   1280x720
```

## Passo a passo de produção

### 1. Pauta (`idea` → usuário aprova → `approved`)
**Só temas provados**: antes de cadastrar, buscar o tema no YouTube e confirmar que algum vídeo já passou de ~1M views (anotar no `--angle`: "Prova: X M (canal)"). Busca rápida pelo navegador: `fetch('/results?search_query=...')` numa aba do youtube.com e ler `ytInitialData`.
Preferir: evento real, específico, com vítimas nomeáveis e uma causa/erro investigável. Antes de 1929 (imagens em domínio público). Evitar gore. O `--angle` diz o que o nosso vídeo traz de diferente.

### 2. Pesquisa + roteiro (`scripting` → `script_review`)
- `research.md`: mínimo 4 fontes confiáveis (acadêmicas, museus, enciclopédias, livros). Separar fato / disputa / lenda.
- `script.md`: 1.200–1.800 palavras (~9–13 min a ~135 wpm). **Estrutura Fascinating Horror** (seções = chapters):
  1. **Gancho (~7%, 30–45 s)** — data + lugar + pessoa pelo nome numa cena calma e cotidiana. Termina revelando a tragédia e escondendo o *como* ("He had no reason to be afraid… and yet this would be the day that…"). Sem "welcome back", sem "in this video".
  2. **Contexto (~35%)** — a história do lugar/tecnologia/costume que o espectador precisa pra entender a falha depois. Incluir acidentes anteriores (prenúncio).
  3. **O incidente (~27%)** — volta à data. Humaniza as vítimas (nome, idade, sonho). Explica o mecanismo e narra o momento devagar. A morte é dita com sobriedade.
  4. **A investigação (~20%)** — causa explicada com uma analogia do dia a dia; quem foi responsabilizado; o que mudou (lei, regra, prática).
  5. **Memorial (~5%)** — quem eram as vítimas. Última frase nomeia a lição/culpa. **Sem CTA de inscrição.**
  - Tom: respeitoso, factual, zero sensacionalismo. A tensão vem da ironia e do detalhe, não de adjetivos.
  - Pessoas sempre com nome e idade; datas e números exatos. Frases curtas, escrito pra ouvir.
- Rodar `status <slug> script_review` e avisar o usuário.

### 3. Cenas (`producing`)
Quebrar o roteiro em cenas de **1–2 frases (~6–8 s de fala)** — a referência troca de visual a cada ~7 s → 75–100 cenas para 10 min. `scenes.json`:
```json
{ "scenes": [
  { "id": "00a", "chapter": "Introduction", "card": "The Dancing Plague", "duration": 3.5 },
  { "id": "00b", "card": "Strasbourg, July 1518", "duration": 2.5 },
  { "id": "01", "text": "...", "image": "images/01.png", "audio": "audio/01.mp3", "motion": "in", "prompt": "..." },
  { "id": "05", "text": "...", "audio": "audio/05.mp3", "image": "archive/hondius.jpg", "archival": true,
    "caption": "The Dancing Mania — engraving by Hendrik Hondius, 1642", "credit": "Wellcome Collection, CC BY 4.0" }
]}
```
Tipos de cena:
- **IA**: `image` + `prompt`. `motion`: in | out | left | right | up | drift | still (omitido = rotação).
- **Arquivo** (`archival: true`): foto/gravura real → o render aplica sépia, moldura, sombra e `caption`. `credit` vai automático pra descrição do YouTube. Movimento padrão `drift` (quase parado).
- **Cartão** (`card`, opcional `sub`; no cartão de título do início usar `"sub": "Gaslight Archive"`): texto em versalete serifado sobre preto. Usar: título no início (3–4 s), data/lugar antes do gancho e na volta ao incidente, datas-chave. Sem `audio` → usa `duration` (silêncio + trilha). Com `audio` → narração sobre o cartão.
- **Clipe** (`clip`): vídeo; caro, só no gancho se valer a pena.
- Meta de mistura: **~40% arquivo real, ~50% IA, ~10% cartões**. Arquivo primeiro; IA cobre o que não tem registro.

#### Imagens de arquivo — onde buscar (sempre domínio público ou CC BY)
- Wikimedia Commons (API: `action=query&list=search&srnamespace=6`; checar `extmetadata.LicenseShortName`), Library of Congress (loc.gov/pictures), Wellcome Collection, British Library Flickr, gravuras de jornais da época (Illustrated London News, Harper's Weekly, Frank Leslie's).
- Salvar em `videos/<slug>/archive/`. Registrar licença no `credit`. Nunca usar foto com copyright ativo (pós-1929 sem licença clara).

### 4. Voz — Higgsfield `generate_audio_batch`
- Modelo: `text2speech_v2`, `variant: "elevenlabs"`, voz definida em `data/brand.json` (`voice_id`). ~3 créditos / 1.000 caracteres, sem mínimo por chamada.
- **1 chamada por cena** (sincronia exata). **Lotes de até 6** (lotes maiores dão 429 rate limit), `jobs_wait`, baixar com `npm run cli -- fetch <slug> audio 01=<url> 02=<url> ...`.
- Registrar custo: `npm run cli -- credits <slug> <total> voice`.

### 5. Imagens — Higgsfield `generate_image_batch`
- Modelo escolhido pelo usuário: `z_image` (cobrança real ~0,25/imagem em lote, apesar do preflight dizer 0,15; 2048x1152), `aspect_ratio: "16:9"`. O z_image tende a sair claro/"pitoresco": o `style` do brand.json força low-key; se sair claro demais, reforçar "night, darkness" na descrição da cena.
- Todo prompt = `<descrição da cena>` + `STYLE` de `data/brand.json` (consistência visual do canal).
- Sem texto nas imagens, sem gore explícito, sem rostos de pessoas reais modernas.
- Baixar com `npm run cli -- fetch <slug> images 01=<url> ...`. Registrar custo (`credits ... image`).

### 6. Thumbnail
- `gpt_image_2_5` (renderiza texto melhor) 16:9 com texto curto (2–4 palavras, MAIÚSCULAS, alto contraste) + um elemento visual forte. Converter para 1280x720 jpg (`ffmpeg -i in.png -vf scale=1280:720 -q:v 2 thumbnail.jpg`).

### 7. SEO — `seo.json`
```json
{ "title": "simples e descritivo, ≤ 60 chars: o evento + o que deu errado (ex.: 'Human Cannonball Stunt Goes Wrong', 'The Victoria Hall Disaster')",
  "description": "2 linhas de resumo com a keyword, parágrafo do canal, capítulos (automático), música creditada, fontes",
  "tags": ["10–15 tags: keyword principal, variações, tema amplo"],
  "hashtags": ["DarkHistory", "History", "<tema>"],
  "categoryId": "27" }
```
Os chapters são adicionados automaticamente a partir do `chapter` das cenas.

### 8. Render → revisão → publicação
`npm run cli -- render <slug>` → status vira `final_review` → o usuário assiste no painel e clica **"Aprovar e agendar"** (sobe privado com `publishAt`, thumbnail e legenda). Ajustes pedidos voltam para `producing`/`scripting` com nota no histórico.

## Trilha sonora
`assets/music/*.mp3` (YouTube Audio Library, categoria Cinematic/Dark Ambient, sem atribuição exigida). Custo de referência: ~38 créditos por vídeo de 10 min (voz ~27 + imagens ~10,5 + thumb). O render escolhe uma por vídeo e mixa a -19 dB sob a voz. `videos/<slug>/music.mp3` força uma trilha específica.

## Publicação via YouTube Studio no Chrome (caminho atual — sem API)
O usuário aprova no painel → status `ready`. Então o Trevor, com **Claude in Chrome** (Chrome logado na conta do canal Gaslight Archive):
1. Confirmar com o usuário no chat antes de cada publicação (é ação pública). Abrir studio.youtube.com e conferir que o canal ativo é **Gaslight Archive**.
2. "Criar → Enviar vídeos". A extensão só sobe arquivos < 10 MB, então o vídeo vem do painel: no console da página do Studio, `fetch('http://localhost:4400/media/<slug>/final.mp4')` → `new File([blob], '<slug>.mp4', {type:'video/mp4'})` → `DataTransfer` → atribuir a `input[type=file]` → disparar `change`. O servidor libera CORS/Private Network só para `https://studio.youtube.com`. O painel (`npm run painel`) precisa estar rodando.
3. Preencher a partir de `seo.json`: título; descrição montada como no `buildDescription` (descrição + Chapters de `chapters.json` + Image credits + hashtags); thumbnail (`thumbnail.jpg` < 2 MB, pode ir pelo `file_upload`); "Não é conteúdo para crianças"; Mostrar mais → tags, idioma Inglês, categoria Educação, **Conteúdo alterado/sintético = Sim**; Legendas → enviar `captions.srt` (com tempos).
4. Visibilidade → **Programar** para `scheduled_at` (converter para o fuso exibido no Studio).
5. Registrar: `npm run cli -- uploaded <slug> <videoId> <ISO>`.

Aprendizados da 1ª publicação (2026-10-08):
- Vídeo: injetar o `File` em `ytcp-uploads-dialog input[type=file]` + evento `change` funcionou (291 MB em ~1 s).
- **Thumbnail**: injetar direto no input NÃO funciona. Funciona interceptando `HTMLInputElement.prototype.click` (entregar o `File` + `change` quando o input de arquivo for "clicado") e clicando em `ytcp-thumbnail-uploader #select-button`. Se o canal não estiver verificado, esse botão abre a aba de verificação por telefone em vez do seletor.
- Fluxo mais seguro: no diálogo de envio preencher título, descrição, "Mostrar mais" (tags, `VIDEO_HAS_ALTERED_CONTENT_YES`, `VIDEO_PAID_PRODUCT_PLACEMENT_NO`) → salvar como **Privado** → abrir `studio.youtube.com/video/<id>/edit` → thumbnail → Salvar → Visibilidade Público → Salvar. Assim o vídeo nunca fica público sem thumbnail.
- Legendas: o YouTube gera a legenda automática em inglês (boa, porque a narração é limpa). Enviar o SRT pela página `/translations` ainda não funcionou (injetar em `#captions-file-loader` não dispara nada) — pendente.
- O diálogo de envio bloqueia a navegação ("Leave site?") enquanto houver alteração não salva: nunca forçar, salvar antes.
Estatísticas: ler Studio → Analytics e registrar com `npm run cli -- video-stats <slug> <views> <likes> <comments>` e `npm run cli -- channel-stats <inscritos> <views> <vídeos>`.

## YouTube API (alternativa — se o Google Cloud for configurado)
O projeto do Cloud pode ser de outra conta; na autorização (`yt-auth`) escolher a conta do canal.
- `secrets/client_secret.json` (OAuth Desktop app) + `npm run cli -- yt-auth` uma vez.
- Projetos não auditados sobem vídeos **travados em privado**. Enquanto a auditoria não sai, os vídeos sobem agendados mas precisam ser liberados no Studio. Pedir auditoria: https://support.google.com/youtube/contact/yt_api_form
- Cota: 10.000 unidades/dia; upload = 1.600, legenda = 400, thumbnail = 50 → ~4 vídeos/dia.
