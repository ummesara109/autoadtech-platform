export type ScreenInfo = {
  id: string;
  code: string;
  label: string;
  placement: string;
};

export type OtpChallenge = {
  challengeId: string;
  vehicleId: string;
  operatorId: string;
  autoNumber: string;
  maskedMobile: string;
  mobileE164: string;
  expiresAt: string;
  createdAt: string;
};

export type SessionPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  operator: {
    id: string;
    displayName: string;
    roleCode: string;
    vehicleId: string;
    autoNumber: string;
  };
  /** Exactly one assigned screen for this Auto Number (manager rule). */
  screen: ScreenInfo;
  /** @deprecated use `screen` — kept empty or single for older clients */
  screens: ScreenInfo[];
};
