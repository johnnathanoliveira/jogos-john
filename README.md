# 🎮 Jogos em Família

Plataforma multiplayer de jogos para jogar em família! O host abre no computador/TV, compartilha o QR Code e cada jogador acessa pelo celular.

**Jogo disponível:** 🎱 Bingo (1–100)  
**Em breve:** Truco, Stop

---

## ✨ Funcionalidades

- **Página inicial** com seleção de jogos
- **Tela do Host (TV/PC)**: QR Code automático, globo animado, grid de números 1–100
- **Tela do Jogador (Mobile)**: escolha de cartela, marcação por toque, botão BINGO! com validação
- Sincronização em **tempo real** via Supabase Realtime
- **Reconexão automática** se o jogador fechar o celular
- Pontuação **por rodada** — cada jogo tem seu campeão e zera após terminar

---

## 🏗️ Stack

| Camada      | Tecnologia              |
|-------------|-------------------------|
| Frontend    | Next.js 14 (App Router) |
| Estilização | Tailwind CSS            |
| Animações   | Framer Motion           |
| Banco/RT    | Supabase (Postgres + Realtime) |
| QR Code     | qrcode.react            |
| Deploy      | Vercel                  |

---

## 🚀 Setup — Passo a Passo

### 1. Pré-requisitos

- [Node.js 18+](https://nodejs.org/)
- Conta no [Supabase](https://supabase.com) (gratuito)
- Conta no [GitHub](https://github.com) + [Vercel](https://vercel.com) (para deploy)

---

### 2. Configurar o Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto
2. Aguarde o projeto inicializar (~2 min)
3. No menu lateral, vá em **SQL Editor**
4. Clique em **New query**
5. Cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**
6. Verifique se as tabelas `game_sessions` e `players` foram criadas em **Table Editor**

**Obtenha as credenciais:**
1. Vá em **Settings → API**
2. Copie a **Project URL** e a **anon public key**

---

### 3. Configurar variáveis de ambiente

```bash
# Copie o arquivo de exemplo
cp .env.local.example .env.local
```

Edite o `.env.local` com suas credenciais do Supabase:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### 4. Instalar dependências e rodar localmente

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000)

> **Dica para testar o QR Code na rede local:** acesse pelo IP da sua máquina em vez de `localhost`.  
> Ex: `http://192.168.1.100:3000` — e use esse endereço para o QR Code funcionar no celular.

---

## 📱 Como Jogar — Bingo

### Fluxo completo

```
Host (PC/TV)                    Jogadores (Celular)
─────────────────────           ─────────────────────
1. Abre a página inicial
2. Clica em "Bingo"
3. Vê QR Code + lista          4. Escaneia o QR Code
   de jogadores                5. Digite seu nome
                                6. Escolhe/troca cartela
                                7. Clica "Pronto!"
8. Todos ficam "Prontos"
9. Clica "Iniciar Jogo"
10. Clica "🎱 GIRAR!"          11. Vê número sorteado
                                12. Toca no número na cartela
                                13. Clica "Já Marquei!"
14. Quando todos marcaram,
    botão "GIRAR!" reativa
                                15. Clica "BINGO!" quando completa
                                    uma linha/coluna/diagonal
16. Valida o BINGO!
17. Exibe o VENCEDOR! 🏆
```

### Regras do Bingo

- Cartela 5×5 com 24 números (1–100) + ⭐ FREE no centro
- Números sorteados aleatoriamente de 1 a 100
- Para ganhar: complete uma **linha**, **coluna** ou **diagonal**
- O botão "GIRAR!" só fica ativo depois que **todos os jogadores** clicam em "Já Marquei!"
- Ao clicar em "BINGO!": a cartela é validada automaticamente
  - Marcação inválida (número não sorteado): erro mostrado, jogo continua
  - Sem padrão vencedor: erro mostrado, jogo continua
  - Válido: vencedor declarado em todas as telas!

---

## 🌐 Deploy no Vercel

### 1. Subir o código no GitHub

```bash
git init
git add .
git commit -m "feat: jogos em família - bingo multiplayer"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

### 2. Importar no Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login
2. Clique em **Add New → Project**
3. Importe o repositório do GitHub
4. Em **Environment Variables**, adicione:

   | Nome | Valor |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | sua URL do Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sua anon key do Supabase |

5. Clique em **Deploy**
6. Aguarde o build (~1 min) e acesse a URL gerada

> O QR Code gerado já usará automaticamente a URL de produção da Vercel!

---

## 🗂️ Estrutura do Projeto

```
Games/
├── src/
│   ├── app/
│   │   ├── page.tsx                          # Página inicial (seleção de jogos)
│   │   ├── layout.tsx                        # Layout raiz
│   │   ├── globals.css                       # Estilos globais + utilitários
│   │   └── bingo/
│   │       ├── host/[sessionId]/page.tsx     # Tela do host (PC/TV)
│   │       └── play/[sessionId]/page.tsx     # Tela do jogador (mobile)
│   ├── components/
│   │   ├── BingoCard.tsx                     # Cartela 5×5 interativa
│   │   └── BingoGlobe.tsx                    # Globo animado
│   └── lib/
│       ├── supabase.ts                       # Cliente Supabase
│       ├── types.ts                          # Tipos TypeScript
│       └── bingo-utils.ts                    # Lógica do jogo
├── supabase/
│   └── schema.sql                            # Schema do banco de dados
├── .env.local.example                        # Exemplo de variáveis de ambiente
└── package.json
```

---

## 🗃️ Schema do Banco

```
game_sessions
├── id            UUID (PK)
├── game_type     text         → 'bingo'
├── status        text         → 'lobby' | 'playing' | 'finished'
├── current_number integer     → número atual sorteado
├── drawn_numbers  integer[]   → todos os números sorteados
├── all_marked    boolean      → todos marcaram o último número
├── winner_id     UUID         → FK para players
├── winner_name   text
└── created_at / updated_at

players
├── id               UUID (PK)
├── session_id       UUID (FK → game_sessions)
├── name             text
├── is_ready         boolean     → confirmou a cartela
├── has_marked       boolean     → marcou o número atual
├── card             jsonb       → cartela 5×5 [[n,n,n,n,n],...]
└── marked_positions integer[]   → índices planos 0-24 marcados
```

---

## 🔧 Scripts

```bash
npm run dev      # Desenvolvimento local (http://localhost:3000)
npm run build    # Build de produção
npm run start    # Serve o build de produção
npm run lint     # Linting com ESLint
```

---

## 🔮 Próximos Jogos

| Jogo  | Status   | Descrição |
|-------|----------|-----------|
| Truco | Em breve | Jogo de cartas 2×2 |
| Stop  | Em breve | Palavras por letra |

---

## 📄 Licença

MIT — use à vontade para jogar em família! 🎉
