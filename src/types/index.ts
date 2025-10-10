
// 공통 타입 정의
export interface AppState {
  user: User | null
  isAuthenticated: boolean
}

export interface User {
  id: string
  username: string
  email: string
}

// TODO: 추가 공통 타입
// - API Response 타입
// - Error 타입
// - Navigation 타입
