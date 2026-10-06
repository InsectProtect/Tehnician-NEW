// Код QR, отсканированный на главной: после выбора заявки и старта выезда экран выезда подхватывает его и сразу открывает обслуживание станции.
const pending: Record<string, string> = {};
export const setPendingScan = (visitId: string, code: string) => { pending[visitId] = code; };
export const takePendingScan = (visitId: string): string | undefined => {
  const c = pending[visitId];
  delete pending[visitId];
  return c;
};
