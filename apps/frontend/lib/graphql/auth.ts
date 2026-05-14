import { gql } from "@apollo/client";

// Types
export interface LoginUserInput {
  email: string;
  password: string;
}

export interface RegisterUserInput {
  email: string;
  username: string;
  password: string;
  department?: string;
  clearance?: string;
}

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

export interface LoginUserData {
  loginUser: AuthTokens;
}

export interface RegisterUserData {
  registerUser: boolean;
}

export interface ForgotPasswordData {
  forgotPassword: boolean;
}

export interface ConfirmForgotPasswordData {
  confirmForgotPassword: boolean;
}

export interface ConfirmForgotPasswordInput {
  email: string;
  confirmationCode: string;
  newPassword: string;
}

// Mutations
export const LOGIN_USER = gql`
  mutation LoginUser($loginUserDto: LoginUserDto!) {
    loginUser(loginUserDto: $loginUserDto) {
      accessToken
      idToken
      refreshToken
    }
  }
`;

export const REGISTER_USER = gql`
  mutation RegisterUser($registerUserDto: RegisterUserDto!) {
    registerUser(registerUserDto: $registerUserDto)
  }
`;

export const FORGOT_PASSWORD = gql`
  mutation ForgotPassword($email: String!) {
    forgotPassword(email: $email)
  }
`;

export const CONFIRM_FORGOT_PASSWORD = gql`
  mutation ConfirmForgotPassword(
    $confirmForgotPasswordDto: ConfirmForgotPasswordDto!
  ) {
    confirmForgotPassword(confirmForgotPasswordDto: $confirmForgotPasswordDto)
  }
`;

// Named mutation result types shared by auth-context and useMagicLink
export interface SendMagicLinkData {
  sendMagicLink: boolean;
}

export interface VerifyMagicLinkData {
  verifyMagicLink: AuthTokens;
}

export interface RegisterWithMagicLinkData {
  registerWithMagicLink: boolean;
}

// ============================================
// Passwordless Authentication
// ============================================

// Passkey Types
export interface PasskeyCredential {
  id: string;
  friendlyName?: string;
  deviceType?: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface PasskeyRegistrationOptionsData {
  generatePasskeyRegistrationOptions: {
    options: PublicKeyCredentialCreationOptionsJSON;
  };
}

export interface PasskeyAuthenticationOptionsData {
  generatePasskeyAuthenticationOptions: {
    options: PublicKeyCredentialRequestOptionsJSON;
    identifier: string;
  };
}

export interface VerifyPasskeyRegistrationData {
  verifyPasskeyRegistration: boolean;
}

export interface VerifyPasskeyAuthenticationData {
  verifyPasskeyAuthentication: AuthTokens;
}

export interface MyPasskeysData {
  myPasskeys: PasskeyCredential[];
}

export interface DeletePasskeyData {
  deletePasskey: boolean;
}

// Magic Link Types
export interface SendMagicLinkData {
  sendMagicLink: boolean;
}

export interface VerifyMagicLinkData {
  verifyMagicLink: AuthTokens;
}

export interface RegisterWithMagicLinkData {
  registerWithMagicLink: boolean;
}

// WebAuthn types (from @simplewebauthn/browser)
export type PublicKeyCredentialCreationOptionsJSON = Record<string, unknown>;
export type PublicKeyCredentialRequestOptionsJSON = Record<string, unknown>;

// Passkey Mutations
export const GENERATE_PASSKEY_REGISTRATION_OPTIONS = gql`
  mutation GeneratePasskeyRegistrationOptions(
    $input: GeneratePasskeyRegistrationOptionsDto!
  ) {
    generatePasskeyRegistrationOptions(input: $input) {
      options
    }
  }
`;

export const VERIFY_PASSKEY_REGISTRATION = gql`
  mutation VerifyPasskeyRegistration($input: VerifyPasskeyRegistrationDto!) {
    verifyPasskeyRegistration(input: $input)
  }
`;

export const GENERATE_PASSKEY_AUTHENTICATION_OPTIONS = gql`
  mutation GeneratePasskeyAuthenticationOptions(
    $input: GeneratePasskeyAuthenticationOptionsDto
  ) {
    generatePasskeyAuthenticationOptions(input: $input) {
      options
      identifier
    }
  }
`;

export const VERIFY_PASSKEY_AUTHENTICATION = gql`
  mutation VerifyPasskeyAuthentication(
    $input: VerifyPasskeyAuthenticationDto!
  ) {
    verifyPasskeyAuthentication(input: $input) {
      accessToken
      idToken
      refreshToken
    }
  }
`;

// Passkey Query
export const MY_PASSKEYS = gql`
  query MyPasskeys {
    myPasskeys {
      id
      friendlyName
      deviceType
      createdAt
      lastUsedAt
    }
  }
`;

export const DELETE_PASSKEY = gql`
  mutation DeletePasskey($credentialId: String!) {
    deletePasskey(credentialId: $credentialId)
  }
`;

// Magic Link Mutations
export const SEND_MAGIC_LINK = gql`
  mutation SendMagicLink($input: SendMagicLinkDto!) {
    sendMagicLink(input: $input)
  }
`;

export const VERIFY_MAGIC_LINK = gql`
  mutation VerifyMagicLink($input: VerifyMagicLinkDto!) {
    verifyMagicLink(input: $input) {
      accessToken
      idToken
      refreshToken
    }
  }
`;

export const REGISTER_WITH_MAGIC_LINK = gql`
  mutation RegisterWithMagicLink($input: RegisterWithMagicLinkDto!) {
    registerWithMagicLink(input: $input)
  }
`;

export interface ExchangeSupabaseSessionData {
  exchangeSupabaseSession: AuthTokens;
}

export const EXCHANGE_SUPABASE_SESSION = gql`
  mutation ExchangeSupabaseSession($input: ExchangeSupabaseSessionDto!) {
    exchangeSupabaseSession(input: $input) {
      accessToken
      idToken
      refreshToken
    }
  }
`;

// Logout mutation to clear httpOnly cookies
export const LOGOUT = gql`
  mutation Logout {
    logout
  }
`;

export interface LogoutData {
  logout: boolean;
}
