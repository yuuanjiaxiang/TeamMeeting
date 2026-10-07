export function meetingParticipants(meeting, users = []) {
  const invited = Array.isArray(meeting?.participant_user_ids) ? new Set(meeting.participant_user_ids.map(Number)) : null;
  return users.filter((user) => user.active !== 0 && (!invited || invited.has(Number(user.id))));
}
