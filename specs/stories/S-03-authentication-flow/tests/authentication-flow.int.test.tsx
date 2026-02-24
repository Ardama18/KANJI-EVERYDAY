// S-03 統合テスト - Design Doc: authentication-flow
// 生成日: 2026-02-23
// テスト種別: Integration Test
// 実装タイミング: 機能実装と同時
//
// ACトレーサビリティ（Requirements AC#1〜#20）:
// AC#1  -> IT-AC01-SIGNUP-VALIDATION
// AC#2  -> IT-AC02-CONFIG-CHECK-GATE
// AC#3  -> IT-AC03-SIGNUP-SUCCESS-REDIRECT
// AC#4  -> IT-AC04-SIGNUP-PROFILE-PERSIST
// AC#5  -> IT-AC05-SIGNUP-PROFILE-ERROR
// AC#6  -> IT-AC06-DUPLICATE-EMAIL-FLOW
// AC#7  -> IT-AC07-WEAK-PASSWORD-FLOW
// AC#8  -> IT-AC08-SIGNUP-SERVER-ERROR
// AC#9  -> IT-AC09-LOGIN-SUCCESS-REDIRECT
// AC#10 -> IT-AC10-LOGIN-AUTH-FAILURE
// AC#11 -> IT-AC11-LOGIN-SERVER-ERROR
// AC#12 -> IT-AC12-FORM-LAYOUT-CONSTRAINTS
// AC#13 -> IT-AC13-LOGIN-RESCUE-THEN-REDIRECT
// AC#14 -> IT-AC14-RESCUE-ON-CONFLICT
// AC#15 -> IT-AC15-MW-REDIRECT-TO-LOGIN
// AC#16 -> IT-AC16-MW-REDIRECT-TO-DECKS
// AC#17 -> IT-AC17-ROOT-PUBLIC-ACCESS
// AC#18 -> IT-AC18-MW-ASSET-PASS
// AC#19 -> IT-AC19-AUTH-LAYOUT-SIGNOUT-FLOW
// AC#20 -> IT-AC20-FORM-ACTION-CSRF-PATH

import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const createMiddlewareClientMock = vi.hoisted(() => vi.fn())
const createServerClientMock = vi.hoisted(() => vi.fn())
const redirectMock = vi.hoisted(() => vi.fn<(location: string) => never>())

vi.mock("@/lib/supabase/middleware", () => ({
  createMiddlewareClient: createMiddlewareClientMock,
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: createServerClientMock,
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

import {
  AUTH_ACTION_INITIAL_STATE,
  AUTH_FIELD_MESSAGES,
  LOGIN_ERROR_MESSAGES,
  SIGN_UP_ERROR_MESSAGES,
} from "@/actions/auth-types"
import { signIn, signOut, signUp } from "@/actions/auth-actions"
import { config as middlewareConfig, middleware } from "../../../../frontend/middleware"

type ClaimsResult = {
  data: { claims: Record<string, unknown> }
  error: null
}

type UserResult = {
  data: { user: { id: string } | null }
  error: null
}

type AuthUser = {
  id: string
  email: string | null
  user_metadata: {
    display_name?: string
  } | null
}

type SignUpPayload = {
  email: string
  password: string
  options: {
    data: {
      display_name: string
    }
  }
}

type SignUpResult = {
  data: {
    user: { id: string } | null
    session: { access_token: string } | null
  }
  error: { code?: string; message: string } | null
}

type SignInPayload = {
  email: string
  password: string
}

type SignInResult = {
  data: {
    user: AuthUser | null
    session: { access_token: string } | null
  }
  error: { code?: string; message: string } | null
}

type GetUserResult = {
  data: {
    user: AuthUser | null
  }
  error: { message: string } | null
}

type SignOutResult = {
  error: { message: string } | null
}

type ProfileInsertPayload = {
  user_id: string
  display_name: string
  timezone: "Asia/Tokyo"
}

type ProfileInsertResult = {
  error: { message: string } | null
}

type ProfileSelectResult = {
  data: { user_id: string } | null
  error: { code?: string; message: string } | null
}

type ProfileUpsertPayload = {
  user_id: string
  display_name: string
  timezone: "Asia/Tokyo"
}

type ProfileUpsertOptions = {
  onConflict: "user_id"
  ignoreDuplicates: true
}

type ProfileUpsertResult = {
  error: { code?: string; message: string } | null
}

const createRequest = (pathname: string) =>
  new NextRequest(new URL(pathname, "https://example.com"))

const createAuthClient = (userId: string | null) => {
  const user = userId === null ? null : { id: userId }

  return {
    auth: {
      getClaims: vi.fn<() => Promise<ClaimsResult>>().mockResolvedValue({
        data: { claims: {} },
        error: null,
      }),
      getUser: vi.fn<() => Promise<UserResult>>().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
  }
}

const createFormData = (input: {
  displayName: string
  email: string
  password: string
}) => {
  const formData = new FormData()
  formData.set("display_name", input.displayName)
  formData.set("email", input.email)
  formData.set("password", input.password)
  return formData
}

const createLoginFormData = (input: { email: string; password: string }) => {
  const formData = new FormData()
  formData.set("email", input.email)
  formData.set("password", input.password)
  return formData
}

class RedirectSignal extends Error {
  constructor(public readonly location: string) {
    super("NEXT_REDIRECT")
  }
}

const setupAuthClient = (options?: {
  signUpResult?: SignUpResult
  profileInsertResult?: ProfileInsertResult
  signInResult?: SignInResult
  getUserResult?: GetUserResult
  signOutResult?: SignOutResult
  profileSelectResult?: ProfileSelectResult
  profileUpsertResult?: ProfileUpsertResult
}) => {
  const signUpMock = vi
    .fn<(payload: SignUpPayload) => Promise<SignUpResult>>()
    .mockResolvedValue(
      options?.signUpResult ?? {
        data: {
          user: { id: "user-1" },
          session: { access_token: "session-token" },
        },
        error: null,
      }
    )

  const signInWithPasswordMock = vi
    .fn<(payload: SignInPayload) => Promise<SignInResult>>()
    .mockResolvedValue(
      options?.signInResult ?? {
        data: {
          user: {
            id: "user-1",
            email: "learner@example.com",
            user_metadata: {
              display_name: "学習者",
            },
          },
          session: { access_token: "session-token" },
        },
        error: null,
      }
    )

  const getUserMock = vi
    .fn<() => Promise<GetUserResult>>()
    .mockResolvedValue(
      options?.getUserResult ?? {
        data: {
          user: {
            id: "user-1",
            email: "learner@example.com",
            user_metadata: {
              display_name: "学習者",
            },
          },
        },
        error: null,
      }
    )

  const signOutMock = vi
    .fn<() => Promise<SignOutResult>>()
    .mockResolvedValue(options?.signOutResult ?? { error: null })

  const insertMock = vi
    .fn<(payload: ProfileInsertPayload) => Promise<ProfileInsertResult>>()
    .mockResolvedValue(options?.profileInsertResult ?? { error: null })

  const maybeSingleMock = vi
    .fn<() => Promise<ProfileSelectResult>>()
    .mockResolvedValue(options?.profileSelectResult ?? { data: null, error: null })

  const eqMock = vi
    .fn<(column: "user_id", value: string) => { maybeSingle: typeof maybeSingleMock }>()
    .mockReturnValue({ maybeSingle: maybeSingleMock })

  const selectMock = vi
    .fn<(columns: "user_id") => { eq: typeof eqMock }>()
    .mockReturnValue({ eq: eqMock })

  const upsertMock = vi
    .fn<
      (payload: ProfileUpsertPayload, options: ProfileUpsertOptions) => Promise<ProfileUpsertResult>
    >()
    .mockResolvedValue(options?.profileUpsertResult ?? { error: null })

  const fromMock = vi
    .fn<
      (table: string) => {
        insert: typeof insertMock
        select: typeof selectMock
        upsert: typeof upsertMock
      }
    >()
    .mockImplementation(() => ({
      insert: insertMock,
      select: selectMock,
      upsert: upsertMock,
    }))

  createServerClientMock.mockReturnValue({
    auth: {
      signUp: signUpMock,
      signInWithPassword: signInWithPasswordMock,
      getUser: getUserMock,
      signOut: signOutMock,
    },
    from: fromMock,
  })

  return {
    signUpMock,
    signInWithPasswordMock,
    getUserMock,
    signOutMock,
    insertMock,
    fromMock,
    selectMock,
    eqMock,
    maybeSingleMock,
    upsertMock,
  }
}

describe("authentication-flow 統合テスト", () => {
  beforeEach(() => {
    createMiddlewareClientMock.mockReset()
    createServerClientMock.mockReset()
    redirectMock.mockReset()
    redirectMock.mockImplementation((location: string) => {
      throw new RedirectSignal(location)
    })
  })

  // 実行順序: Phase 1 - signup 入力/エラー制御

  // AC原文トレース: AC#1
  // 検証観点: /signup の入力制約が UI + Server Action で一貫して適用される
  // @category: integration
  // @dependency: frontend/app/signup/page.tsx, frontend/src/components/auth/signup-form.tsx, frontend/src/actions/auth-actions.ts
  // @complexity: medium
  it("IT-AC01: /signup 入力検証が display_name(1-20)/email形式/password(8+) を満たす", async () => {
    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createFormData({
        displayName: " ",
        email: "invalid-email",
        password: "short",
      })
    )

    expect(state).toEqual({
      status: "error",
      fieldErrors: {
        displayName: AUTH_FIELD_MESSAGES.displayName,
        email: AUTH_FIELD_MESSAGES.email,
        password: AUTH_FIELD_MESSAGES.password,
      },
    })
    expect(createServerClientMock).not.toHaveBeenCalled()
  })

  // AC原文トレース: AC#2
  // 検証観点: email confirmation 設定不一致時は構成エラーとして扱い、要件成立を停止する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, deployment checklist
  // @complexity: medium
  it("IT-AC02: MVP環境で Enable email confirmations=OFF 前提を検証ゲートとして扱う", async () => {
    setupAuthClient({
      signUpResult: {
        data: {
          user: { id: "user-1" },
          session: null,
        },
        error: null,
      },
    })

    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createFormData({
        displayName: "学習者",
        email: "learner@example.com",
        password: "password-123",
      })
    )

    expect(state).toEqual({
      status: "error",
      message: SIGN_UP_ERROR_MESSAGES.configMismatch,
    })
    expect(redirectMock).not.toHaveBeenCalled()
  })

  // AC原文トレース: AC#3
  // 検証観点: signup 成功でセッション確立後に /decks へ遷移する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/app/signup/page.tsx
  // @complexity: medium
  it("IT-AC03: signup 成功時にメール確認待ちなしで /decks へリダイレクトする", async () => {
    setupAuthClient()

    await expect(
      signUp(
        AUTH_ACTION_INITIAL_STATE,
        createFormData({
          displayName: "学習者",
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)
  })

  // AC原文トレース: AC#4
  // 検証観点: signup 成功時に users_profile が display_name + timezone=Asia/Tokyo で作成される
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, public.users_profile
  // @complexity: high
  it("IT-AC04: signup 成功後に users_profile を期待値で永続化する", async () => {
    const { insertMock } = setupAuthClient({
      signUpResult: {
        data: {
          user: { id: "user-42" },
          session: { access_token: "session-token" },
        },
        error: null,
      },
    })

    await expect(
      signUp(
        AUTH_ACTION_INITIAL_STATE,
        createFormData({
          displayName: "  まいにち漢字の学習者です  ",
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)

    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-42",
      display_name: "まいにち漢字の学習者です",
      timezone: "Asia/Tokyo",
    })
  })

  // AC原文トレース: AC#5
  // 検証観点: profile 作成失敗時に遷移停止 + エラー表示し、Authユーザーを保持する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/src/components/auth/auth-error-banner.tsx
  // @complexity: high
  it("IT-AC05: signup の profile 作成失敗時に成功遷移せず失敗メッセージを表示する", async () => {
    setupAuthClient({
      profileInsertResult: {
        error: { message: "profile insert failed" },
      },
    })

    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createFormData({
        displayName: "学習者",
        email: "learner@example.com",
        password: "password-123",
      })
    )

    expect(state).toEqual({
      status: "error",
      message: SIGN_UP_ERROR_MESSAGES.profileCreateFailed,
    })
    expect(redirectMock).not.toHaveBeenCalled()
  })

  // AC原文トレース: AC#6
  // 検証観点: 重複メール時の専用エラーメッセージを表示する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/src/components/auth/auth-error-banner.tsx
  // @complexity: low
  it("IT-AC06: 重複メール時に既定文言を表示する", async () => {
    setupAuthClient({
      signUpResult: {
        data: { user: null, session: null },
        error: { code: "user_already_exists", message: "User already exists" },
      },
    })

    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createFormData({
        displayName: "学習者",
        email: "duplicated@example.com",
        password: "password-123",
      })
    )

    expect(state).toEqual({
      status: "error",
      message: SIGN_UP_ERROR_MESSAGES.duplicateEmail,
    })
  })

  // AC原文トレース: AC#7
  // 検証観点: パスワード要件不足時の専用エラーメッセージを表示する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/src/components/auth/auth-error-banner.tsx
  // @complexity: low
  it("IT-AC07: パスワード要件不足時に既定文言を表示する", async () => {
    setupAuthClient({
      signUpResult: {
        data: { user: null, session: null },
        error: { code: "weak_password", message: "Password should be at least 8 characters." },
      },
    })

    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createFormData({
        displayName: "学習者",
        email: "learner@example.com",
        password: "12345678",
      })
    )

    expect(state).toEqual({
      status: "error",
      message: SIGN_UP_ERROR_MESSAGES.weakPassword,
    })
  })

  // AC原文トレース: AC#8
  // 検証観点: signup サーバーエラー時に汎用失敗文言を表示する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/src/components/auth/auth-error-banner.tsx
  // @complexity: low
  it("IT-AC08: signup サーバーエラー時に再試行文言を表示する", async () => {
    setupAuthClient({
      signUpResult: {
        data: { user: null, session: null },
        error: { code: "unexpected_error", message: "database timeout" },
      },
    })

    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createFormData({
        displayName: "学習者",
        email: "learner@example.com",
        password: "password-123",
      })
    )

    expect(state).toEqual({
      status: "error",
      message: SIGN_UP_ERROR_MESSAGES.serverError,
    })
  })

  // 実行順序: Phase 2 - login / rescue

  // AC原文トレース: AC#9
  // 検証観点: login 成功で /decks に遷移する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/app/login/page.tsx
  // @complexity: medium
  it("IT-AC09: /login 認証成功時に /decks へリダイレクトする", async () => {
    const { signInWithPasswordMock, upsertMock } = setupAuthClient()

    await expect(
      signIn(
        AUTH_ACTION_INITIAL_STATE,
        createLoginFormData({
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "password-123",
    })
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  // AC原文トレース: AC#10
  // 検証観点: 認証失敗時に credentials 不一致文言を表示する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/src/components/auth/auth-error-banner.tsx
  // @complexity: low
  it("IT-AC10: /login 認証失敗時に既定文言を表示する", async () => {
    const { upsertMock } = setupAuthClient({
      signInResult: {
        data: {
          user: null,
          session: null,
        },
        error: {
          code: "invalid_credentials",
          message: "Invalid login credentials",
        },
      },
    })

    const state = await signIn(
      AUTH_ACTION_INITIAL_STATE,
      createLoginFormData({
        email: "learner@example.com",
        password: "wrong-password",
      })
    )

    expect(state).toEqual({
      status: "error",
      message: LOGIN_ERROR_MESSAGES.invalidCredentials,
    })
    expect(upsertMock).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  // AC原文トレース: AC#11
  // 検証観点: login サーバーエラー時に汎用失敗文言を表示する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/src/components/auth/auth-error-banner.tsx
  // @complexity: low
  it("IT-AC11: /login サーバーエラー時に再試行文言を表示する", async () => {
    const { upsertMock } = setupAuthClient({
      signInResult: {
        data: {
          user: null,
          session: null,
        },
        error: {
          code: "unexpected_error",
          message: "database timeout",
        },
      },
    })

    const state = await signIn(
      AUTH_ACTION_INITIAL_STATE,
      createLoginFormData({
        email: "learner@example.com",
        password: "password-123",
      })
    )

    expect(state).toEqual({
      status: "error",
      message: LOGIN_ERROR_MESSAGES.serverError,
    })
    expect(upsertMock).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  // AC原文トレース: AC#12
  // 検証観点: /login と /signup のモバイル優先 UI 制約を満たす
  // @category: integration
  // @dependency: frontend/app/login/page.tsx, frontend/app/signup/page.tsx, frontend/src/components/auth/*
  // @complexity: medium
  it("IT-AC12: フォーム max-width 28rem・入力/ボタン 48px以上・主ボタン全幅を満たす", () => {
    const loginFormSource = readFileSync(
      new URL("../../../../frontend/src/components/auth/login-form.tsx", import.meta.url),
      "utf8"
    )
    const signupFormSource = readFileSync(
      new URL("../../../../frontend/src/components/auth/signup-form.tsx", import.meta.url),
      "utf8"
    )
    const submitButtonSource = readFileSync(
      new URL("../../../../frontend/src/components/auth/submit-button.tsx", import.meta.url),
      "utf8"
    )

    expect(loginFormSource).toContain("max-w-[28rem]")
    expect(signupFormSource).toContain("max-w-[28rem]")
    expect(loginFormSource).toContain("h-12")
    expect(signupFormSource).toContain("h-12")
    expect(submitButtonSource).toContain("h-12")
    expect(submitButtonSource).toContain("w-full")
  })

  // AC原文トレース: AC#13
  // 検証観点: login 成功時に profile 欠損を検知したら救済作成後に /decks へ遷移する
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/src/lib/auth/ensure-user-profile.ts
  // @complexity: high
  it("IT-AC13: profile 欠損ユーザーの login で救済作成してから /decks へ遷移する", async () => {
    const { eqMock, upsertMock } = setupAuthClient({
      signInResult: {
        data: {
          user: {
            id: "user-42",
            email: "profile-missing@example.com",
            user_metadata: {
              display_name: "学習者",
            },
          },
          session: { access_token: "session-token" },
        },
        error: null,
      },
      profileSelectResult: {
        data: null,
        error: null,
      },
    })

    await expect(
      signIn(
        AUTH_ACTION_INITIAL_STATE,
        createLoginFormData({
          email: "profile-missing@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)

    expect(eqMock).toHaveBeenCalledWith("user_id", "user-42")
    expect(upsertMock).toHaveBeenCalledWith(
      {
        user_id: "user-42",
        display_name: "学習者",
        timezone: "Asia/Tokyo",
      },
      {
        onConflict: "user_id",
        ignoreDuplicates: true,
      }
    )
  })

  // AC原文トレース: AC#14
  // 検証観点: rescue を複数回実行しても同一 user_id の profile 行が1件を維持する
  // @category: integration
  // @dependency: frontend/src/lib/auth/ensure-user-profile.ts, public.users_profile
  // @complexity: high
  it("IT-AC14: users_profile 救済作成の冪等性を維持する", async () => {
    setupAuthClient({
      profileUpsertResult: {
        error: {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        },
      },
    })

    await expect(
      signIn(
        AUTH_ACTION_INITIAL_STATE,
        createLoginFormData({
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)
  })

  // 実行順序: Phase 3 - middleware / routing / signout

  // AC原文トレース: AC#15
  // 検証観点: 未認証で /decks と /decks/* にアクセスすると /login へリダイレクトする
  // @category: integration
  // @dependency: frontend/middleware.ts
  // @complexity: medium
  it.each(["/decks", "/decks/chapter-1"])(
    "IT-AC15: 未認証アクセス %s を /login へリダイレクトする",
    async (pathname) => {
      const authClient = createAuthClient(null)
      createMiddlewareClientMock.mockReturnValue(authClient)

      const response = await middleware(createRequest(pathname))

      expect(createMiddlewareClientMock).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(307)
      expect(response.headers.get("location")).toBe("https://example.com/login")
    }
  )

  // AC原文トレース: AC#16
  // 検証観点: 認証済みで /login または /signup にアクセスすると /decks へリダイレクトする
  // @category: integration
  // @dependency: frontend/middleware.ts
  // @complexity: medium
  it.each(["/login", "/signup"])(
    "IT-AC16: 認証済みユーザーの guest-only %s を /decks へリダイレクトする",
    async (pathname) => {
      const authClient = createAuthClient("user-1")
      createMiddlewareClientMock.mockReturnValue(authClient)

      const response = await middleware(createRequest(pathname))

      expect(createMiddlewareClientMock).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(307)
      expect(response.headers.get("location")).toBe("https://example.com/decks")
    }
  )

  // AC原文トレース: AC#17
  // 検証観点: 公開ルート / は認証有無に関係なく表示される
  // @category: integration
  // @dependency: frontend/middleware.ts, frontend/app/page.tsx
  // @complexity: low
  it("IT-AC17: 公開ルート / は認証状態に関係なく閲覧可能である", async () => {
    const response = await middleware(createRequest("/"))

    expect(createMiddlewareClientMock).not.toHaveBeenCalled()
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  // AC原文トレース: AC#18
  // 検証観点: matcher 除外パスでは認証リダイレクトを発生させない
  // @category: integration
  // @dependency: frontend/middleware.ts
  // @complexity: medium
  it("IT-AC18: matcher が /_next/static・/_next/image・/favicon.ico を除外する", () => {
    expect(middlewareConfig.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"])
  })

  it.each(["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico"])(
    "IT-AC18: 除外パス %s では認証リダイレクトしない",
    async (pathname) => {
      const response = await middleware(createRequest(pathname))

      expect(createMiddlewareClientMock).not.toHaveBeenCalled()
      expect(response.headers.get("x-middleware-next")).toBe("1")
    }
  )

  // AC原文トレース: AC#19
  // 検証観点: 認証済みレイアウトにアプリ名とログアウト導線があり、signOut 後に /login へ遷移する
  // @category: integration
  // @dependency: frontend/app/(auth)/layout.tsx, frontend/src/components/auth/signout-button.tsx, frontend/src/actions/auth-actions.ts
  // @complexity: medium
  it("IT-AC19: auth layout のログアウト導線実行で /login に遷移する", async () => {
    const authLayoutSource = readFileSync(
      new URL("../../../../frontend/app/(auth)/layout.tsx", import.meta.url),
      "utf8"
    )
    const signoutButtonSource = readFileSync(
      new URL("../../../../frontend/src/components/auth/signout-button.tsx", import.meta.url),
      "utf8"
    )
    const authActionsSource = readFileSync(
      new URL("../../../../frontend/src/actions/auth-actions.ts", import.meta.url),
      "utf8"
    )

    expect(authLayoutSource).toContain("まいにち漢字")
    expect(authLayoutSource).toContain("SignOutButton")
    expect(signoutButtonSource).toContain("action={signOut}")
    expect(authActionsSource).toContain('const SIGN_OUT_REDIRECT_PATH = "/login"')

    const { signOutMock } = setupAuthClient()
    await expect(signOut()).rejects.toThrowError(/NEXT_REDIRECT/)

    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  // SH原文トレース: SH-02
  // 検証観点: login/signup 間の導線リンクが常時表示される
  // @category: integration
  // @dependency: frontend/src/components/auth/login-form.tsx, frontend/src/components/auth/signup-form.tsx
  // @complexity: low
  it("IT-SH02: login/signup の相互導線リンクを常時表示する", () => {
    const loginFormSource = readFileSync(
      new URL("../../../../frontend/src/components/auth/login-form.tsx", import.meta.url),
      "utf8"
    )
    const signupFormSource = readFileSync(
      new URL("../../../../frontend/src/components/auth/signup-form.tsx", import.meta.url),
      "utf8"
    )

    expect(loginFormSource).toContain('href="/signup"')
    expect(signupFormSource).toContain('href="/login"')
  })

  // AC原文トレース: AC#20
  // 検証観点: signUp/signIn/signOut が Server Actions として form action に接続される
  // @category: integration
  // @dependency: frontend/src/actions/auth-actions.ts, frontend/app/login/page.tsx, frontend/app/signup/page.tsx, frontend/app/(auth)/layout.tsx
  // @complexity: medium
  it("IT-AC20: 認証操作がフォーム経由の Server Actions 経路で実行される", async () => {
    const { signUpMock, signInWithPasswordMock, signOutMock } = setupAuthClient()
    const source = readFileSync(
      new URL("../../../../frontend/src/actions/auth-actions.ts", import.meta.url),
      "utf8"
    )
    const loginFormSource = readFileSync(
      new URL("../../../../frontend/src/components/auth/login-form.tsx", import.meta.url),
      "utf8"
    )
    const signupFormSource = readFileSync(
      new URL("../../../../frontend/src/components/auth/signup-form.tsx", import.meta.url),
      "utf8"
    )
    const signoutButtonSource = readFileSync(
      new URL("../../../../frontend/src/components/auth/signout-button.tsx", import.meta.url),
      "utf8"
    )
    const loginPageSource = readFileSync(
      new URL("../../../../frontend/app/login/page.tsx", import.meta.url),
      "utf8"
    )
    const signupPageSource = readFileSync(
      new URL("../../../../frontend/app/signup/page.tsx", import.meta.url),
      "utf8"
    )
    const authLayoutSource = readFileSync(
      new URL("../../../../frontend/app/(auth)/layout.tsx", import.meta.url),
      "utf8"
    )

    await expect(
      signUp(
        AUTH_ACTION_INITIAL_STATE,
        createFormData({
          displayName: "学習者",
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)

    await expect(
      signIn(
        AUTH_ACTION_INITIAL_STATE,
        createLoginFormData({
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)

    await expect(signOut()).rejects.toThrowError(/NEXT_REDIRECT/)

    expect(source).toContain('"use server"')
    expect(source).toContain("export async function signIn")
    expect(source).toContain("export async function signOut")
    expect(loginFormSource).toContain("useFormState(signIn")
    expect(loginFormSource).toContain("action={formAction}")
    expect(signupFormSource).toContain("useFormState(signUp")
    expect(signupFormSource).toContain("action={formAction}")
    expect(signoutButtonSource).toContain("action={signOut}")
    expect(loginPageSource).toContain("LoginForm")
    expect(signupPageSource).toContain("SignupForm")
    expect(authLayoutSource).toContain("SignOutButton")
    expect(signUpMock).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "password-123",
      options: {
        data: {
          display_name: "学習者",
        },
      },
    })
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "password-123",
    })
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })
})
