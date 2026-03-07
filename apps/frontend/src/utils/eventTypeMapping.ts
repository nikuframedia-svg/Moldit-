/**
 * Maps frontend event type codes (SCREAMING_SNAKE_CASE) to backend RunEventType values (PascalCase).
 * Backend only supports 6 types. Frontend-only types are mapped to null.
 */

export const FRONTEND_TO_BACKEND_EVENT_TYPE: Record<string, string | null> = {
  MACHINE_DOWN: 'MachineDown',
  MACHINE_UP: 'MachineUp',
  QUALITY_HOLD: 'QualityHold',
  OPERATOR_ABSENT: 'OperatorAbsent',
  OPERATOR_BACK: 'OperatorBack',
  SCRAP_EVENT: 'ScrapEvent',
  // Frontend-only types (no backend equivalent yet)
  URGENT_ORDER: null,
  ORDER_CANCELLED: null,
  MATERIAL_SHORTAGE: null,
  MATERIAL_ARRIVED: null,
  RUSH_ORDER: null,
  CUSTOM: null,
};

export const BACKEND_TO_FRONTEND_EVENT_TYPE: Record<string, string> = {
  MachineDown: 'MACHINE_DOWN',
  MachineUp: 'MACHINE_UP',
  QualityHold: 'QUALITY_HOLD',
  OperatorAbsent: 'OPERATOR_ABSENT',
  OperatorBack: 'OPERATOR_BACK',
  ScrapEvent: 'SCRAP_EVENT',
};

/** Returns true if the event type is supported by the backend API */
export function isBackendSupportedEventType(frontendType: string): boolean {
  return (
    FRONTEND_TO_BACKEND_EVENT_TYPE[frontendType] !== null &&
    FRONTEND_TO_BACKEND_EVENT_TYPE[frontendType] !== undefined
  );
}

/** Converts frontend event type to backend format, throws if unsupported */
export function toBackendEventType(frontendType: string): string {
  const mapped = FRONTEND_TO_BACKEND_EVENT_TYPE[frontendType];
  if (!mapped) {
    throw new Error(`Event type "${frontendType}" is not supported by the backend API`);
  }
  return mapped;
}

/** Converts backend event type to frontend format */
export function toFrontendEventType(backendType: string): string {
  return BACKEND_TO_FRONTEND_EVENT_TYPE[backendType] || backendType;
}
