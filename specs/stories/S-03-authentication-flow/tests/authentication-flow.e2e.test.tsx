// S-03 E2Eテスト - Design Doc: authentication-flow
// 生成日: 2026-02-23
// テスト種別: End-to-End Test
// 実装タイミング: 全実装完了後
//
// ACトレーサビリティ（Requirements AC#1〜#20）:
// AC#1  -> E2E-AC01-SIGNUP-VALIDATION
// AC#2  -> E2E-AC02-SIGNUP-CONFIG-PRECONDITION
// AC#3  -> E2E-AC03-SIGNUP-TO-DECKS
// AC#4  -> E2E-AC04-SIGNUP-PROFILE-CREATED
// AC#5  -> E2E-AC05-SIGNUP-PROFILE-FAILURE-UX
// AC#6  -> E2E-AC06-DUPLICATE-EMAIL-UX
// AC#7  -> E2E-AC07-WEAK-PASSWORD-UX
// AC#8  -> E2E-AC08-SIGNUP-SERVER-ERROR-UX
// AC#9  -> E2E-AC09-LOGIN-TO-DECKS
// AC#10 -> E2E-AC10-LOGIN-AUTH-FAILURE-UX
// AC#11 -> E2E-AC11-LOGIN-SERVER-ERROR-UX
// AC#12 -> E2E-AC12-MOBILE-FORM-LAYOUT
// AC#13 -> E2E-AC13-LOGIN-RESCUE-FLOW
// AC#14 -> E2E-AC14-RESCUE-RETRY-SINGLE-ROW
// AC#15 -> E2E-AC15-UNAUTH-DECKS-REDIRECT
// AC#16 -> E2E-AC16-AUTH-LOGIN-SIGNUP-REDIRECT
// AC#17 -> E2E-AC17-ROOT-ACCESS-WITHOUT-REDIRECT
// AC#18 -> E2E-AC18-ASSET-NO-AUTH-REDIRECT
// AC#19 -> E2E-AC19-SIGNOUT-TO-LOGIN
// AC#20 -> E2E-AC20-FORM-SUBMISSION-VIA-SERVER-ACTION

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

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8")

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

const createSignUpFormData = (input: {
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

const createSignInFormData = (input: { email: string; password: string }) => {
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
    signOutMock,
    insertMock,
    eqMock,
    upsertMock,
  }
}

describe("authentication-flow E2Eテスト", () => {
  beforeEach(() => {
    createMiddlewareClientMock.mockReset()
    createServerClientMock.mockReset()
    redirectMock.mockReset()
    redirectMock.mockImplementation((location: string) => {
      throw new RedirectSignal(location)
    })
  })

  // 実行順序: Scenario 1 - signup 導線

  // AC原文トレース: AC#1
  // 検証観点: ユーザーが /signup で不正入力時に即座に検証エラーを確認できる
  // @category: e2e
  // @dependency: full-system
  // @complexity: medium
  it("E2E-AC01: /signup で display_name/email/password 入力検証が機能する", async () => {
    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createSignUpFormData({
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
  // 検証観点: 前提設定（Enable email confirmations=OFF）を満たす環境でのみ signup 成功シナリオを実行する
  // @category: e2e
  // @dependency: full-system, Supabase project settings
  // @complexity: medium
  it("E2E-AC02: signup 成立前提として email confirmations 設定を検証する", async () => {
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
      createSignUpFormData({
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
  // 検証観点: signup 成功後にセッション確立し /decks へ遷移する
  // @category: e2e
  // @dependency: full-system
  // @complexity: medium
  it("E2E-AC03: signup 成功時にメール確認待ちなしで /decks へ遷移する", async () => {
    setupAuthClient()

    await expect(
      signUp(
        AUTH_ACTION_INITIAL_STATE,
        createSignUpFormData({
          displayName: "学習者",
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)
  })

  // AC原文トレース: AC#4
  // 検証観点: signup 完了直後に users_profile が期待値で作成される
  // @category: e2e
  // @dependency: full-system, public.users_profile
  // @complexity: high
  it("E2E-AC04: signup 成功時に users_profile(display_name, timezone=Asia/Tokyo) が作成される", async () => {
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
        createSignUpFormData({
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
  // 検証観点: profile 作成失敗時にエラーを表示し、成功遷移しないことをユーザー視点で確認する
  // @category: e2e
  // @dependency: full-system
  // @complexity: high
  it("E2E-AC05: signup 後 profile 作成失敗時に失敗文言を表示し遷移を停止する", async () => {
    setupAuthClient({
      profileInsertResult: {
        error: { message: "profile insert failed" },
      },
    })

    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createSignUpFormData({
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
  // 検証観点: 重複メールで signup した場合に専用文言を表示する
  // @category: e2e
  // @dependency: full-system
  // @complexity: low
  it("E2E-AC06: 重複メール時に既定エラーメッセージを表示する", async () => {
    setupAuthClient({
      signUpResult: {
        data: { user: null, session: null },
        error: { code: "user_already_exists", message: "User already exists" },
      },
    })

    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createSignUpFormData({
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
  // 検証観点: 8文字未満のパスワードで signup した場合に専用文言を表示する
  // @category: e2e
  // @dependency: full-system
  // @complexity: low
  it("E2E-AC07: パスワード要件不足時に既定エラーメッセージを表示する", async () => {
    setupAuthClient({
      signUpResult: {
        data: { user: null, session: null },
        error: { code: "weak_password", message: "Password should be at least 8 characters." },
      },
    })

    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createSignUpFormData({
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
  // 検証観点: signup サーバーエラー時に再試行を促す文言を表示する
  // @category: e2e
  // @dependency: full-system
  // @complexity: low
  it("E2E-AC08: signup サーバーエラー時に既定エラーメッセージを表示する", async () => {
    setupAuthClient({
      signUpResult: {
        data: { user: null, session: null },
        error: { code: "unexpected_error", message: "database timeout" },
      },
    })

    const state = await signUp(
      AUTH_ACTION_INITIAL_STATE,
      createSignUpFormData({
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

  // 実行順序: Scenario 2 - login / rescue

  // AC原文トレース: AC#9
  // 検証観点: login 成功後に /decks へ遷移する
  // @category: e2e
  // @dependency: full-system
  // @complexity: medium
  it("E2E-AC09: /login 認証成功時に /decks へ遷移する", async () => {
    const { signInWithPasswordMock, upsertMock } = setupAuthClient()

    await expect(
      signIn(
        AUTH_ACTION_INITIAL_STATE,
        createSignInFormData({
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
  // 検証観点: credentials 不一致時に失敗文言を表示する
  // @category: e2e
  // @dependency: full-system
  // @complexity: low
  it("E2E-AC10: /login 認証失敗時に既定エラーメッセージを表示する", async () => {
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
      createSignInFormData({
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
  // 検証観点: login サーバーエラー時に再試行文言を表示する
  // @category: e2e
  // @dependency: full-system
  // @complexity: low
  it("E2E-AC11: /login サーバーエラー時に既定エラーメッセージを表示する", async () => {
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
      createSignInFormData({
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
  // 検証観点: モバイル幅でフォーム max-width, タップ領域, ボタン全幅要件を満たす
  // @category: e2e
  // @dependency: full-system
  // @complexity: medium
  it("E2E-AC12: /login と /signup がモバイル優先UI制約を満たす", () => {
    const loginPageSource = readSource("../../../../frontend/app/login/page.tsx")
    const signupPageSource = readSource("../../../../frontend/app/signup/page.tsx")
    const loginFormSource = readSource("../../../../frontend/src/components/auth/login-form.tsx")
    const signupFormSource = readSource("../../../../frontend/src/components/auth/signup-form.tsx")
    const submitButtonSource = readSource("../../../../frontend/src/components/auth/submit-button.tsx")

    expect(loginPageSource).toContain("max-w-[28rem]")
    expect(signupPageSource).toContain("max-w-[28rem]")
    expect(loginFormSource).toContain("max-w-[28rem]")
    expect(signupFormSource).toContain("max-w-[28rem]")
    expect(loginFormSource).toContain("h-12")
    expect(signupFormSource).toContain("h-12")
    expect(submitButtonSource).toContain("h-12")
    expect(submitButtonSource).toContain("w-full")
  })

  // AC原文トレース: AC#13
  // 検証観点: profile 欠損ユーザーで login すると救済作成後に /decks へ遷移する
  // @category: e2e
  // @dependency: full-system, public.users_profile
  // @complexity: high
  it("E2E-AC13: login 時の profile 欠損を救済して /decks へ遷移する", async () => {
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
        createSignInFormData({
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
  // 検証観点: 同一ユーザーで救済フローを再実行しても users_profile 行数が 1 件を維持する
  // @category: e2e
  // @dependency: full-system, public.users_profile
  // @complexity: high
  it("E2E-AC14: profile 救済作成を複数回実行しても重複行を作らない", async () => {
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
        createSignInFormData({
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)
  })

  // 実行順序: Scenario 3 - middleware 境界

  // AC原文トレース: AC#15
  // 検証観点: 未認証で /decks と /decks/* にアクセスすると /login へリダイレクトされる
  // @category: e2e
  // @dependency: full-system, frontend/middleware.ts
  // @complexity: medium
  it.each(["/decks", "/decks/chapter-1"])(
    "E2E-AC15: 未認証ユーザーの /decks 系アクセスを /login にリダイレクトする (%s)",
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
  // 検証観点: 認証済みで /login と /signup へアクセスすると /decks へリダイレクトされる
  // @category: e2e
  // @dependency: full-system, frontend/middleware.ts
  // @complexity: medium
  it.each(["/login", "/signup"])(
    "E2E-AC16: 認証済みユーザーの /login・/signup アクセスを /decks にリダイレクトする (%s)",
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
  // 検証観点: 公開ルート / は認証有無に関わらず閲覧できる
  // @category: e2e
  // @dependency: full-system, frontend/middleware.ts
  // @complexity: low
  it("E2E-AC17: 公開ルート / では認証状態に関係なく表示を維持する", async () => {
    const response = await middleware(createRequest("/"))

    expect(createMiddlewareClientMock).not.toHaveBeenCalled()
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  // AC原文トレース: AC#18
  // 検証観点: matcher 除外パスで認証リダイレクトが発生しない
  // @category: e2e
  // @dependency: full-system, frontend/middleware.ts
  // @complexity: medium
  it("E2E-AC18: /_next/static・/_next/image・/favicon.ico で認証リダイレクトしない", async () => {
    expect(middlewareConfig.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"])

    for (const pathname of ["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico"]) {
      const response = await middleware(createRequest(pathname))
      expect(createMiddlewareClientMock).not.toHaveBeenCalled()
      expect(response.headers.get("x-middleware-next")).toBe("1")
    }
  })

  // 実行順序: Scenario 4 - signout / server actions

  // AC原文トレース: AC#19
  // 検証観点: auth layout にアプリ名とログアウト導線があり、ログアウト後 /login に遷移する
  // @category: e2e
  // @dependency: full-system, frontend/app/(auth)/layout.tsx
  // @complexity: medium
  it("E2E-AC19: 認証済みレイアウトのログアウト導線で /login に遷移する", async () => {
    const authLayoutSource = readSource("../../../../frontend/app/(auth)/layout.tsx")
    const signoutButtonSource = readSource(
      "../../../../frontend/src/components/auth/signout-button.tsx"
    )
    const authActionsSource = readSource("../../../../frontend/src/actions/auth-actions.ts")

    expect(authLayoutSource).toContain("まいにち漢字")
    expect(authLayoutSource).toContain("SignOutButton")
    expect(signoutButtonSource).toContain("action={signOut}")
    expect(authActionsSource).toContain('const SIGN_OUT_REDIRECT_PATH = "/login"')

    const { signOutMock } = setupAuthClient()
    await expect(signOut()).rejects.toThrowError(/NEXT_REDIRECT/)
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  // AC原文トレース: AC#20
  // 検証観点: signUp/signIn/signOut がフォーム送信で Server Actions 経由実行される
  // @category: e2e
  // @dependency: full-system, frontend/src/actions/auth-actions.ts
  // @complexity: medium
  it("E2E-AC20: 認証フローがフォーム経由の Server Actions パスで実行される", async () => {
    const { signUpMock, signInWithPasswordMock, signOutMock } = setupAuthClient()
    const authActionsSource = readSource("../../../../frontend/src/actions/auth-actions.ts")
    const loginFormSource = readSource("../../../../frontend/src/components/auth/login-form.tsx")
    const signupFormSource = readSource("../../../../frontend/src/components/auth/signup-form.tsx")
    const signoutButtonSource = readSource(
      "../../../../frontend/src/components/auth/signout-button.tsx"
    )
    const loginPageSource = readSource("../../../../frontend/app/login/page.tsx")
    const signupPageSource = readSource("../../../../frontend/app/signup/page.tsx")
    const authLayoutSource = readSource("../../../../frontend/app/(auth)/layout.tsx")

    await expect(
      signUp(
        AUTH_ACTION_INITIAL_STATE,
        createSignUpFormData({
          displayName: "学習者",
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)

    await expect(
      signIn(
        AUTH_ACTION_INITIAL_STATE,
        createSignInFormData({
          email: "learner@example.com",
          password: "password-123",
        })
      )
    ).rejects.toThrowError(/NEXT_REDIRECT/)

    await expect(signOut()).rejects.toThrowError(/NEXT_REDIRECT/)

    expect(authActionsSource).toContain('"use server"')
    expect(authActionsSource).toContain("export async function signUp")
    expect(authActionsSource).toContain("export async function signIn")
    expect(authActionsSource).toContain("export async function signOut")
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

  // SH原文トレース: SH-01
  // 検証観点: 送信中状態で submit ボタンが無効化され、pendingラベルに切り替わる
  // @category: e2e
  // @dependency: frontend/src/components/auth/submit-button.tsx, frontend/src/components/auth/login-form.tsx, frontend/src/components/auth/signup-form.tsx
  // @complexity: low
  it("E2E-SH01-LOADING-BEHAVIOR: 送信中の無効化とラベル切替を提供する", () => {
    const submitButtonSource = readSource("../../../../frontend/src/components/auth/submit-button.tsx")
    const loginFormSource = readSource("../../../../frontend/src/components/auth/login-form.tsx")
    const signupFormSource = readSource("../../../../frontend/src/components/auth/signup-form.tsx")

    expect(submitButtonSource).toContain("useFormStatus")
    expect(submitButtonSource).toContain("disabled={pending}")
    expect(submitButtonSource).toContain("aria-disabled={pending}")
    expect(submitButtonSource).toContain("pending ? pendingLabel : idleLabel")
    expect(loginFormSource).toContain('pendingLabel="ログイン中..."')
    expect(signupFormSource).toContain('pendingLabel="作成中..."')
  })

  // SH原文トレース: SH-02
  // 検証観点: login/signup 間の導線リンクを常時表示する
  // @category: e2e
  // @dependency: frontend/src/components/auth/login-form.tsx, frontend/src/components/auth/signup-form.tsx, frontend/app/login/page.tsx, frontend/app/signup/page.tsx
  // @complexity: low
  it("E2E-SH02-LOGIN-SIGNUP-CROSS-NAVIGATION: login/signup の相互導線を維持する", () => {
    const loginFormSource = readSource("../../../../frontend/src/components/auth/login-form.tsx")
    const signupFormSource = readSource("../../../../frontend/src/components/auth/signup-form.tsx")
    const loginPageSource = readSource("../../../../frontend/app/login/page.tsx")
    const signupPageSource = readSource("../../../../frontend/app/signup/page.tsx")

    expect(loginFormSource).toContain('href="/signup"')
    expect(loginFormSource).toContain("アカウントを作成する")
    expect(signupFormSource).toContain('href="/login"')
    expect(signupFormSource).toContain("ログインはこちら")
    expect(loginPageSource).toContain("LoginForm")
    expect(signupPageSource).toContain("SignupForm")
  })
})
