const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer,
  stopServer,
  wipeDatabase,
  api,
  loginAsUser,
  createApprovedShopWithEvent,
} = require('./helpers');

let baseUrl;

before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

// Invites the given phone to the shop and returns the assignment id, driving the real
// endpoint so the notification payload the mobile app reads gets built the same way.
// The phone is registered first: inviting only works for numbers that have an account.
async function inviteStaff(shopId, ownerToken, phone) {
  await loginAsUser(baseUrl, phone);
  const res = await api(baseUrl, `/v1/shops/${shopId}/staff/invite`, {
    method: 'POST',
    token: ownerToken,
    body: { phone },
  });
  assert.equal(res.status, 201);
  return res.data.id;
}

test('an invited user can reject the invitation', async () => {
  const { shopId, owner } = await createApprovedShopWithEvent(baseUrl);
  const phone = '0833333331';
  const assignmentId = await inviteStaff(shopId, owner.token, phone);
  const invitee = await loginAsUser(baseUrl, phone);

  const res = await api(baseUrl, `/v1/staff/invitations/${assignmentId}/reject`, {
    method: 'POST',
    token: invitee.token,
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'rejected');

  // A rejected invite must not leave the user holding shop access. GET /v1/me only
  // reports `status: 'active'` assignments, which is what the app's staff-mode guard reads.
  const me = await api(baseUrl, '/v1/me', { token: invitee.token });
  assert.equal(
    me.data.roles.shopStaff.some((s) => s.shopId === shopId),
    false,
    'rejecting must not grant shop access'
  );
});

test('rejecting twice is refused — the second call sees a non-invited row', async () => {
  const { shopId, owner } = await createApprovedShopWithEvent(baseUrl);
  const phone = '0833333332';
  const assignmentId = await inviteStaff(shopId, owner.token, phone);
  const invitee = await loginAsUser(baseUrl, phone);

  const first = await api(baseUrl, `/v1/staff/invitations/${assignmentId}/reject`, { method: 'POST', token: invitee.token });
  assert.equal(first.status, 200);

  const second = await api(baseUrl, `/v1/staff/invitations/${assignmentId}/reject`, { method: 'POST', token: invitee.token });
  assert.equal(second.status, 409);
  assert.equal(second.data.error, 'NOT_INVITED');
});

test('a rejected invitation can no longer be accepted', async () => {
  const { shopId, owner } = await createApprovedShopWithEvent(baseUrl);
  const phone = '0833333333';
  const assignmentId = await inviteStaff(shopId, owner.token, phone);
  const invitee = await loginAsUser(baseUrl, phone);

  await api(baseUrl, `/v1/staff/invitations/${assignmentId}/reject`, { method: 'POST', token: invitee.token });

  const accept = await api(baseUrl, `/v1/staff/invitations/${assignmentId}/accept`, { method: 'POST', token: invitee.token });
  assert.equal(accept.status, 409);
  assert.equal(accept.data.error, 'NOT_INVITED');
});

test('someone else cannot reject an invitation that is not theirs', async () => {
  const { shopId, owner } = await createApprovedShopWithEvent(baseUrl);
  const assignmentId = await inviteStaff(shopId, owner.token, '0833333334');
  const stranger = await loginAsUser(baseUrl, '0833333335');

  const res = await api(baseUrl, `/v1/staff/invitations/${assignmentId}/reject`, {
    method: 'POST',
    token: stranger.token,
  });
  assert.equal(res.status, 403);
  assert.equal(res.data.error, 'FORBIDDEN');
});

// The whole point of parking the row at 'rejected' rather than reusing 'removed' or
// leaving it 'invited': the duplicate guard only blocks ['active','invited'], so a
// decline must not lock the shop out of ever asking that person again.
test('the shop can re-invite someone who rejected, and the new invite is acceptable', async () => {
  const { shopId, owner } = await createApprovedShopWithEvent(baseUrl);
  const phone = '0833333336';
  const firstAssignmentId = await inviteStaff(shopId, owner.token, phone);
  const invitee = await loginAsUser(baseUrl, phone);

  await api(baseUrl, `/v1/staff/invitations/${firstAssignmentId}/reject`, { method: 'POST', token: invitee.token });

  const secondAssignmentId = await inviteStaff(shopId, owner.token, phone);
  assert.notEqual(secondAssignmentId, firstAssignmentId);

  const accept = await api(baseUrl, `/v1/staff/invitations/${secondAssignmentId}/accept`, {
    method: 'POST',
    token: invitee.token,
  });
  assert.equal(accept.status, 200);
  assert.equal(accept.data.status, 'active');
});

// ShopEventsScreen is a staff-mode destination (read-only). It was gated on
// manager/owner, so every staff member saw "โหลดรายการ Event ไม่สำเร็จ" and an empty list.
test('an active staff member can read the shop event list', async () => {
  const { shopId, owner } = await createApprovedShopWithEvent(baseUrl);
  const phone = '0833333340';
  const assignmentId = await inviteStaff(shopId, owner.token, phone);
  const staff = await loginAsUser(baseUrl, phone);

  const beforeAccepting = await api(baseUrl, `/v1/shops/${shopId}/events`, { token: staff.token });
  assert.equal(beforeAccepting.status, 403, 'an invite that was never accepted grants nothing');

  await api(baseUrl, `/v1/staff/invitations/${assignmentId}/accept`, { method: 'POST', token: staff.token });

  const res = await api(baseUrl, `/v1/shops/${shopId}/events`, { token: staff.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.length, 1, 'staff must see the shop’s events');

  // ...and losing the role takes the access away again.
  const assignment = await api(baseUrl, `/v1/shops/${shopId}/staff`, { token: owner.token });
  const row = assignment.data.find((s) => s.id === assignmentId);
  await api(baseUrl, `/v1/shops/${shopId}/staff/${row.id}`, { method: 'DELETE', token: owner.token });

  const afterRemoval = await api(baseUrl, `/v1/shops/${shopId}/events`, { token: staff.token });
  assert.equal(afterRemoval.status, 403, 'a removed staff member loses access immediately');
});

test('an outsider still cannot read the shop event list', async () => {
  const { shopId } = await createApprovedShopWithEvent(baseUrl);
  const stranger = await loginAsUser(baseUrl, '0833333341');

  const res = await api(baseUrl, `/v1/shops/${shopId}/events`, { token: stranger.token });
  assert.equal(res.status, 403);
});

test('a rejected invite disappears from the shop staff list', async () => {
  const { shopId, owner } = await createApprovedShopWithEvent(baseUrl);
  const phone = '0833333337';
  const assignmentId = await inviteStaff(shopId, owner.token, phone);
  const invitee = await loginAsUser(baseUrl, phone);

  const before = await api(baseUrl, `/v1/shops/${shopId}/staff`, { token: owner.token });
  assert.equal(before.data.some((s) => s.id === assignmentId), true, 'invited row should be listed');

  await api(baseUrl, `/v1/staff/invitations/${assignmentId}/reject`, { method: 'POST', token: invitee.token });

  const after = await api(baseUrl, `/v1/shops/${shopId}/staff`, { token: owner.token });
  assert.equal(after.data.some((s) => s.id === assignmentId), false, 'rejected row must be filtered out');
});
