export function isPremium(user) {
  if (user.subscriptionPlan !== "premium") return false;
  if (!user.subscriptionExpiresAt) return true;
  return new Date(user.subscriptionExpiresAt) > new Date(); // expired = back to free
}