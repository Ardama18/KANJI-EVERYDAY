---
id: ADR-006
feature: illustration-display-integration
type: adr
version: 1.0.0
created: 2026-02-24
status: Accepted
based_on: specs/stories/S-09-illustration-display-integration/requirements.md
related_epic: specs/epics/E-03-illustration-generation/epic.md
---

# ADR-006: S-09のイラスト表示契約を5状態正規化で統合する

## ステータス

Accepted

## コンテキスト

S-08（ADR-004）はイラスト生成バックエンドのMVP境界を確定したが、S-07時点の学習フローでは `revealCard` が `illustrationUrl=null` 固定で、UIはプレースホルダのみを表示していた。  
S-09では、生成済み画像の表示を学習裏面に統合しつつ、以下の論点を固定する必要がある。

1. `revealCard` の戻り値契約をどう拡張し、状態分岐をどこで正規化するか
2. `illustrations` レコード未存在時に `triggerIllustrationGeneration` の `ok` / `started` をどうUI表示へ反映するか
3. Signed URL（3600秒）と画像表示失敗時フォールバックをどの責務で扱うか
4. 裏面表示の学習テンポを崩さず、表面にイラストを出さない境界をどう保証するか

## 決定事項

1. `revealCard(sessionId)` は `illustrationStatus` と `illustrationUrl` を返す契約へ拡張する。  
   `illustrationStatus` は `ready | pending | generating | failed | none` の5値に固定する。
2. `illustrationStatus` の正規化は `revealCard`（Server Action）で一元化する。UIは受信値をそのまま描画に使う。
3. サーバー側の状態マッピングは以下を採用する。
   - `illustration_key = null` -> `none` / `illustrationUrl = null`
   - `illustrations.status = ready` かつ `storage_path` あり -> `ready` / Signed URL（expiresIn=3600）
   - `illustrations.status = pending` -> `pending` / `null`
   - `illustrations.status = failed` -> `failed` / `null`
   - `illustrations` レコードなしで `triggerIllustrationGeneration(cardId)` 実行時:
     - `ok=true && started=true` -> `generating` / `null`
     - `ok=true && started=false` -> `pending` / `null`
     - `ok=false` または例外 -> `pending` / `null`
4. `CardBack` は `IllustrationDisplay` に `illustrationStatus` / `illustrationUrl` を渡し、表示分岐を実装する。
   - `none`: `null` を返し領域非表示
   - `pending` / `generating`: ローディングプレースホルダ
   - `failed`: 子ども向け静的プレースホルダ（再試行UIなし）
   - `ready`: Next.js `<Image>` で表示し、読み込み失敗時はプレースホルダへフォールバック
5. 表面（front）ではイラストを表示しない。  
   `frontend/next.config.mjs` の `images.remotePatterns` に `*.supabase.co/storage/v1/object/sign/**` を許可し、`<Image>` は `priority` を使わず lazy・`width`/`height`/`sizes` 明記を必須とする。

## 根拠

### 検討した選択肢

#### 選択肢1: クライアント主導で状態推定（URL有無判定 + 追加API/ポーリング）
- 説明
  - `revealCard` は最小情報のみ返し、状態判定をクライアントで行う。レコード未存在時の進捗は追加呼び出しで補完する。
- 利点
  - Server Actionの変更量を最小化できる。
- 欠点
  - 表示ロジックが分散し、同一カードで画面間の挙動差が出やすい。
  - 追加API呼び出しで学習テンポが不安定になる。
  - `none` と `pending` の区別が曖昧になり、DOM要件を満たしにくい。

#### 選択肢2: サーバー正規化だが3状態（ready/pending/failed）に圧縮
- 説明
  - `generating` と `none` を `pending` に統合し、UI分岐を簡略化する。
- 利点
  - 列挙値が少なく実装は単純になる。
- 欠点
  - `illustration_key=null` の完全非表示要件を状態だけで表現できない。
  - `ok=true && started=true` の観測可能性を失い、運用分析や受入条件の測定が弱くなる。

#### 選択肢3（採用）: サーバー正規化の5状態契約 + UI決定的分岐
- 説明
  - `revealCard` で5状態へ正規化し、UIは状態マッピングのみ実施する。画像失敗時は画面内フォールバックで学習継続を優先する。
- 利点
  - サーバーとUIの責務境界が明確で、表示分岐が決定的になる。
  - `none` 非表示・`generating` 表示の双方を要件どおりに測定可能化できる。
  - 追加API呼び出しなしで裏面描画でき、学習テンポを維持しやすい。
- 欠点
  - `illustrationStatus` を扱う型・分岐が増え、実装箇所は広がる。
  - `pending` フォールバックを多用するため、根本障害の可視化は別途メトリクス整備が必要。

### 比較マトリクス

| 評価軸 | 選択肢1 クライアント主導 | 選択肢2 3状態圧縮 | 選択肢3 5状態正規化（採用） |
|---|---|---|---|
| S-09 Must要件適合性 | 低 | 中 | 高 |
| 表示分岐の一貫性 | 低 | 中 | 高 |
| 追加API不要（AC-20） | 低 | 高 | 高 |
| `none` の完全非表示表現 | 低 | 低 | 高 |
| 競合時（started=false）の説明可能性 | 低 | 低 | 高 |
| 実装単純性 | 中 | 高 | 中 |

### 決定理由

- S-09の受入条件は `none` 非表示と `generating` 表示を明示的に要求しており、3状態圧縮では契約が不足する。
- 学習フローは「非阻害」が優先であり、`triggerIllustrationGeneration` の失敗や競合時にも `revealCard` 自体を失敗させない設計が必要である。
- 状態判定をサーバーへ集約することで、`CardBack` と将来の表示コンポーネント双方で再利用可能な契約を維持できる。
- `ready` 時のみ Signed URL（3600秒）を返す境界は、ADR-004のprivate storage方針と整合する。

## 影響

### ポジティブな影響

- `revealCard` 1回の応答で裏面表示を完結でき、追加問い合わせなしでUIを描画できる。
- 例外・競合時も `pending` に正規化され、学習継続性を優先できる。
- `none` 非表示と `ready` 画像表示の差分が明確になり、受入条件をDOM観測で検証しやすい。

### ネガティブな影響

- `illustrationStatus` の導入により、Server Action・型・UIコンポーネントの同時変更が必要になる。
- `pending` へのフォールバックは体験を守る一方で、障害の検知感度を下げる可能性がある（メトリクス整備が前提）。

### 中立的な影響

- `failed` の再試行（自動/手動）はS-09対象外のままとする。
- リアルタイム更新（polling/SSE）はFutureで再評価する。

## 実装への指針

- `revealCard` は `illustrationStatus` を唯一の真実源として返し、UI側で追加判定を実装しない。
- `triggerIllustrationGeneration` 呼び出しは `try-catch` で囲み、`ok=false` と例外を `pending` に統一する。
- `ready` 以外で Signed URL生成や画像リクエストを発生させない。
- `IllustrationDisplay` は `status='none'` で `null` を返し、領域DOM自体を出力しない。
- `<Image>` の失敗時フォールバックはコンポーネント内状態で扱い、評価操作（rate）は常に継続可能にする。
- 画像許可設定は `frontend/next.config.mjs` を単一ソースとして管理する。

## 受入条件（EARS）

- 遍在型: システムは `revealCard` で `illustrationStatus` を `ready|pending|generating|failed|none` の5値に正規化して返すこと。
- 選択型: もし `illustration_key` が `null` ならば、システムは `illustrationStatus='none'` と `illustrationUrl=null` を返すこと。
- 契機型: `illustrations` レコードが存在せず `triggerIllustrationGeneration` が `ok=true && started=true` を返したとき、システムは `illustrationStatus='generating'` を返すこと。
- 選択型: もし `triggerIllustrationGeneration` が `ok=false` を返す、または例外が発生したならば、システムは `illustrationStatus='pending'` として学習継続を優先すること。
- 状態型: `illustrationStatus='none'` の間、システムはイラスト領域DOMを描画しないこと。
- 状態型: `illustrationStatus='ready'` の間、システムは `<Image>` を用いて描画し、読み込み失敗時はプレースホルダ表示へ切り替えること。
- 遍在型: システムは表面（front）でイラストを表示しないこと。

## 参考資料

- `specs/stories/S-09-illustration-display-integration/requirements.md`
- `specs/stories/S-08-illustration-generation-backend/requirements.md`
- `specs/epics/E-03-illustration-generation/epic.md`
- `specs/adr/ADR-004-illustration-generation-backend-mvp-decisions.md`
- `specs/adr/ADR-005-study-session-flow.md`
- Supabase Docs, `createSignedUrl`: https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
- Next.js Docs, Image Component: https://nextjs.org/docs/app/api-reference/components/image
- Next.js Docs, `images.remotePatterns`: https://nextjs.org/docs/app/api-reference/config/next-config-js/images

## 関連情報

- `specs/stories/S-09-illustration-display-integration/story.md`
