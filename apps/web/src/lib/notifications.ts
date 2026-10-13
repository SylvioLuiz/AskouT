/** Avisa o resto do app (o sino) que os avisos não lidos podem ter mudado. */
export const NOTIFICATIONS_CHANGED_EVENT = 'askout:notifications-changed';
export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}
