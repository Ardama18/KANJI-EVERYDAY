# Backend アーキテクチャ（NestJS）

## 技術スタック

- **フレームワーク**: NestJS 11
- **言語**: TypeScript
- **ORM**: Prisma 6 / PostgreSQL
- **バリデーション**: class-validator + Global ValidationPipe
- **認証**: Session Cookie（parent / child）
- **テスト**: Jest（unit/integration）

## ディレクトリ構成

```
backend/src/
├── main.ts                    # ブートストラップ（CORS, Session, Swagger, ValidationPipe）
├── app.module.ts              # ルートモジュール
├── prisma/                    # PrismaService / PrismaModule
├── common/                    # guard, util, shared types
└── modules/
    ├── auth/
    ├── tasks/
    ├── reward/
    ├── point/
    ├── gametime/
    ├── learning-timer/
    ├── time-extension/
    ├── dashboard/
    ├── report/
    ├── settings/
    ├── children/
    ├── task-templates/
    ├── srm/
    ├── srm-profile/
    └── ai/
```

## 基本データフロー

`Controller -> Service -> PrismaService -> PostgreSQL`

- Controller: HTTP入出力と認可境界
- Service: ビジネスロジック
- DTO: 入出力契約（`dto/*.dto.ts`）
- Exception: ドメイン固有エラー（`exceptions/*.exception.ts`）

## 主要実装パターン

### 1. モジュール単位の縦割り

- 1機能ごとに `controller / service / module / dto / exceptions` を配置
- 共有ロジックは `common/` に集約

### 2. 入力検証

- `main.ts` で `ValidationPipe` をグローバル設定
- DTOに `class-validator` デコレータを付与して検証

### 3. 認証・認可

- 親・子で別Cookieを使用（`hapico.parent.sid`, `hapico.child.sid`）
- Guardでアクセス制御（`ParentAuthGuard`, `ChildAuthGuard`, `ChildOrParentAuthGuard`）
- `main.ts` でAPIパスごとに適切なsession middlewareを適用

### 4. スケジューラ

- `@nestjs/schedule` を利用
- 例: `auto-sync.scheduler.ts`, `extension-job-scheduler.service.ts`

## API運用

- Swagger: `/api/docs`
- 静的配信: `/uploads/*`（証跡画像など）
- CORS: 環境変数 `FRONTEND_URL` を基準に許可

## 参照先

- 命名規則: `.claude/rules/naming-convention.md`
- 技術仕様: `.claude/steering/technical-spec.md`
