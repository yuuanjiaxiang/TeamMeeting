import assert from 'node:assert/strict';
import { meetingParticipants } from '../static/meeting-participants.js';
const users = [{id:1,active:1}, {id:2,active:1}, {id:3,active:0}];
assert.deepEqual(meetingParticipants({participant_user_ids:[2]}, users).map(u=>u.id), [2]);
assert.deepEqual(meetingParticipants({participant_user_ids:null}, users).map(u=>u.id), [1,2]);
assert.deepEqual(meetingParticipants({}, users).map(u=>u.id), [1,2]);
assert.deepEqual(meetingParticipants({participant_user_ids:[]}, users), []);
console.log('Meeting participants: selection, inactive users and legacy meetings passed');
