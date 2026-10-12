/* Lesson player route: fetch the rendered lesson and hand it to the player. */

import { get } from '../api.js';
import { createPlayer } from '../player/player.js';

export default async function view({ params, setTitle }) {
  const { subject, course, unit, lesson } = params;
  const data = await get(`/api/lessons/${subject}/${course}/${unit}/${lesson}`);
  setTitle(data.title);
  return createPlayer({ lesson: data, mode: 'lesson', backHref: `/c/${subject}/${course}` });
}
