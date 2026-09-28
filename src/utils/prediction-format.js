import { t } from './messages.js';
import { predictionLabels } from '../services/prediction-session.js';

export function formatPredictionDuration(durationSeconds) {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  if (!minutes) return t('prediction.durationSeconds', { seconds });
  if (!seconds) return t('prediction.durationMinutes', { minutes });
  return t('prediction.durationMinutesSeconds', { minutes, seconds });
}

export function formatRemaining(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function predictionView(preset) {
  const [label1, label2] = predictionLabels(preset);
  return {
    ...preset,
    label1,
    label2,
    duration: formatPredictionDuration(preset.durationSeconds),
  };
}
