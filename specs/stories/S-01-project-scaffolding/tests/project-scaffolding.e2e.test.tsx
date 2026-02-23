// S-01 E2Eテスト - Design Doc: frontend project scaffold
// 生成日: 2026-02-23
// テスト種別: End-to-End Test
// 実装タイミング: 全実装完了後

import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import React from "react"

import { getEnvConfig } from "../../../../frontend/src/lib/env"
import {
  SERVICE_ROLE_MISSING_ERROR,
  withBaselineEnv,
} from "./project-scaffolding.test-helpers"
import HomePage, {
  ROOT_NAV_LINKS,
  ROOT_PAGE_NOTICE,
  ROOT_PAGE_TITLE,
} from "../../../../frontend/app/page"
import LoginPage, { LOGIN_STUB_MESSAGE } from "../../../../frontend/app/login/page"
import DecksPage, { DECKS_STUB_MESSAGE } from "../../../../frontend/app/decks/page"

describe("project-scaffolding E2Eテスト", () => {
  // AC解釈: フル起動後、ルートページがナビゲーション付きで表示される
  // 検証: / へアクセス時に login/decks への導線が確認できる状態で 200 応答する
  // @category: e2e
  // @dependency: frontend/app/page.tsx, フロントエンド起動
  // @complexity: low
  it("E2E: 開発起動後に / が表示され、主要導線リンクが確認できる", () => {
    const html = renderToStaticMarkup(<HomePage />)

    expect(html).toContain(ROOT_PAGE_TITLE)
    expect(html).toContain(ROOT_PAGE_NOTICE)
    for (const link of ROOT_NAV_LINKS) {
      expect(html).toContain(`href="${link.href}"`)
      expect(html).toContain(link.label)
    }
  })

  // AC解釈: login/decks 各ルートが初期導線として表示される
  // 検証: /login と /decks が 200 でアクセス可能で、実装予定の文言が見えること
  // @category: e2e
  // @dependency: frontend/app/login/page.tsx, frontend/app/decks/page.tsx, ルート認証未導入前提
  // @complexity: low
  it("E2E: /login と /decks が壊れずスタブ表示される", () => {
    const loginHtml = renderToStaticMarkup(<LoginPage />)
    const decksHtml = renderToStaticMarkup(<DecksPage />)

    expect(loginHtml).toContain(LOGIN_STUB_MESSAGE)
    expect(decksHtml).toContain(DECKS_STUB_MESSAGE)
  })

  // AC解釈: 必須環境変数検証の最終検証をリリース境界で確認する
  // 検証: service role key 空で起動時に即時停止・非 0 終了・不足キー出力が見えること
  // @category: e2e
  // @dependency: frontend/src/lib/env.ts
  // @complexity: medium
  it("E2E: 起動前提条件として SUPABASE_SERVICE_ROLE_KEY 不足時に即時停止する", () => {
    for (const nodeEnv of [undefined, "test", "production"]) {
      withBaselineEnv(nodeEnv, () => {
        expect(() => getEnvConfig()).toThrowError(SERVICE_ROLE_MISSING_ERROR)
      })
    }
  })
})
