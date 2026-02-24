// S-01 統合テスト - Design Doc: frontend project scaffold
// 生成日: 2026-02-23
// テスト種別: Integration Test
// 実装タイミング: 機能実装と同時

import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import React from "react"

import {
  PROJECT_FILES,
  REQUIRED_ENV_KEYS,
  SERVICE_ROLE_MISSING_ERROR,
  readTextFile,
  withBaselineEnv,
} from "./project-scaffolding.test-helpers"
import { createBrowserClient } from "../../../../frontend/src/lib/supabase/client"
import { createServerClient } from "../../../../frontend/src/lib/supabase/server"
import { getEnvConfig } from "../../../../frontend/src/lib/env"
import HomePage, {
  ROOT_NAV_LINKS,
  ROOT_PAGE_NOTICE,
  ROOT_PAGE_TITLE,
} from "../../../../frontend/app/page"
import { DECKS_STUB_MESSAGE } from "../../../../frontend/app/(auth)/decks/page"

describe("project-scaffolding 統合テスト", () => {
  // AC解釈: .env.local.example は supabase 3 鍵を必ず明記し、鍵名漏れなしを担保する
  // 検証: 3 要件キー（NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY）が例外なく定義されていること
  // @category: integration
  // @dependency: frontend/.env.local.example
  // @complexity: low
  it("AC1: .env.local.example が 3 キー定義を常時提供する", () => {
    const envExample = readTextFile(PROJECT_FILES.envExample)

    for (const key of REQUIRED_ENV_KEYS) {
      expect(envExample).toContain(`${key}=`)
    }
  })

  // AC解釈: 起動/テスト時に環境変数検証を実行し、サービスロールキー未設定時に停止する
  // 検証: NODE_ENV 未設定・test・本番のいずれでも同等に例外が発生し、欠落キー一覧が出力される
  // @category: integration
  // @dependency: frontend/src/lib/env.ts
  // @complexity: high
  it("AC2: SUPABASE_SERVICE_ROLE_KEY 未設定時に NODE_ENV に関係なく起動を失敗させる", () => {
    for (const nodeEnv of [undefined, "development", "test", "production"]) {
      withBaselineEnv(nodeEnv, () => {
        expect(() => getEnvConfig()).toThrowError(SERVICE_ROLE_MISSING_ERROR)
      })
    }
  })

  // AC解釈: /login は認証導線ページとして存在する
  // 検証: app/login/page.tsx が LoginForm 導線とタイトル定義を持つこと
  // @category: integration
  // @dependency: frontend/app/login/page.tsx
  // @complexity: low
  it("AC4: /login アクセス時にログイン導線ページが返る", () => {
    const source = readTextFile(PROJECT_FILES.loginPage)

    expect(source).toContain("LOGIN_PAGE_TITLE")
    expect(source).toContain("LoginForm")
  })

  // AC解釈: /decks はスタブ文言を返す
  // 検証: app/(auth)/decks/page.tsx がデッキ一覧実装予定の案内を返し、壊れないこと
  // @category: integration
  // @dependency: frontend/app/(auth)/decks/page.tsx
  // @complexity: low
  it("AC5: /decks アクセス時にデッキ一覧実装予定スタブページが返る", () => {
    const source = readTextFile(PROJECT_FILES.decksPage)

    expect(source).toContain(DECKS_STUB_MESSAGE)
  })

  // AC解釈: ルートはナビゲーション付きトップを返す
  // 検証: app/page.tsx が login/decks への導線を含むことを確認する
  // @category: integration
  // @dependency: frontend/app/page.tsx
  // @complexity: low
  it("AC3: / で nav を含むトップページが返る", () => {
    const html = renderToStaticMarkup(<HomePage />)

    expect(html).toContain(ROOT_PAGE_TITLE)
    expect(html).toContain(ROOT_PAGE_NOTICE)
    for (const link of ROOT_NAV_LINKS) {
      expect(html).toContain(`href="${link.href}"`)
      expect(html).toContain(link.label)
    }
  })

  // AC解釈: サーバー/ブラウザ用クライアントが分離され、env バリデーション済み値のみ参照する
  // 検証: server.ts が createServerClient、client.ts が createBrowserClient を使い、それぞれ env.ts の公開/非公開キー分離を守る
  // @category: integration
  // @dependency: frontend/src/lib/supabase/server.ts, frontend/src/lib/supabase/client.ts, frontend/src/lib/env.ts
  // @complexity: medium
  it("AC6: createServerClient / createBrowserClient の分離と env.ts 参照方式が連携する", () => {
    expect(createServerClient).toBeTypeOf("function")
    expect(createBrowserClient).toBeTypeOf("function")
    const serverSource = readTextFile(PROJECT_FILES.serverClient)
    const browserSource = readTextFile(PROJECT_FILES.browserClient)

    expect(serverSource).toContain("getEnvConfig(")
    expect(browserSource).toContain("getEnvConfig(")
    expect(serverSource).toMatch(/createSupabaseServerClient(?:<[^>]+>)?\(/)
    expect(browserSource).toMatch(/createSupabaseBrowserClient(?:<[^>]+>)?\(/)
    expect(serverSource).not.toContain("SUPABASE_SERVICE_ROLE_KEY")
    expect(browserSource).not.toContain("SUPABASE_SERVICE_ROLE_KEY")
  })

  // AC解釈: process.env の直接参照が禁止されている
  // 検証: env 周辺の実装が env.ts 以外から直接参照しないことをコードスキャンで担保する
  // @category: integration
  // @dependency: frontend/src/lib/env.ts
  // @complexity: medium
  it("AC7: 設計外仕様として process.env の直接参照が検知されたらレビュー阻止対象になる", () => {
    const scannedFiles = [
      PROJECT_FILES.env,
      PROJECT_FILES.serverClient,
      PROJECT_FILES.browserClient,
      PROJECT_FILES.homePage,
      PROJECT_FILES.loginPage,
      PROJECT_FILES.decksPage,
    ]
    const expectedAllowedFiles = [PROJECT_FILES.env]
    const directAccess = scannedFiles.filter((filePath) => {
      const source = readTextFile(filePath)
      return source.includes("process.env")
    })

    expect(directAccess).toEqual(expectedAllowedFiles)

    const envSource = readTextFile(PROJECT_FILES.env)
    expect(envSource).toContain("requireEnv(REQUIRED_ENV_KEYS)")
    expect(envSource).toContain("process.env")
  })
})
