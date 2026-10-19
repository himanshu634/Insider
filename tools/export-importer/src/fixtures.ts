/**
 * Small synthetic exports used by the tests. Names, numbers and prices are
 * made up; the shapes follow real Android and iOS exports, including the
 * invisible marks (U+200E, U+202A/U+202C, U+202F) the apps insert.
 */

const NNBSP = ' '; // narrow no-break space newer Android builds put before am/pm
const LRM = '‎';

export const ANDROID_EXPORT = [
  '19/10/26, 9:00 am - Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them. Learn more.',
  '19/10/26, 9:01 am - Ramesh Patel created group "Unjha Bhav"',
  `19/10/26, 9:41${NNBSP}am - Ramesh Patel: એરંડા ભાવ આજે`,
  'ઊંઝા 1250-1290',
  'ડીસા 1240-1280',
  '',
  `19/10/26, 9:45${NNBSP}am - ‪+91 98765 43210‬: Magfali 1100/1180 Rajkot`,
  '19/10/26, 10:02 am - Suresh Bhai: <Media omitted>',
  '19/10/26, 10:05 am - Suresh Bhai added Mahesh',
  '19/10/26, 10:06 am - Ramesh Patel changed the subject from "Unjha Bhav" to "Bhav: Unjha"',
  '19/10/26, 2:30 pm - Mahesh: IMG-20261019-WA0007.jpg (file attached)',
  'જીરું rate sheet',
  '19/10/26, 3:00 pm - Ramesh Patel: This message was deleted',
  '19/10/26, 12:10 pm - Mahesh: Cotton 7200 Gondal <This message was edited>',
  '20/10/26, 12:05 am - Suresh Bhai: Good night, kal mandi bandh',
  '20/10/26, 2:15 am - Ramesh Patel: એરંડા 1300 ઊંઝા',
  '',
].join('\n');

export const IOS_EXPORT = [
  `${LRM}[19/10/26, 09:00:00] Unjha Bhav: ${LRM}Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`,
  '[19/10/26, 09:41:12] Ramesh Patel: એરંડા 1250-1290',
  'ઊંઝા',
  `${LRM}[19/10/26, 10:02:30] Suresh Bhai: ${LRM}image omitted`,
  `${LRM}[19/10/26, 10:03:00] Suresh Bhai: ${LRM}<attached: 00000012-Bhav-patrak.pdf>`,
  '[19/10/26, 9:41:12 PM] Mahesh: Groundnut 1150 Rajkot',
  `${LRM}[19/10/26, 21:50:00] Unjha Bhav: ${LRM}Ramesh Patel added Mahesh`,
  `[19/10/26, 21:55:00] ${LRM}+91 98765 43210: Jeera 4400`,
].join('\n');
