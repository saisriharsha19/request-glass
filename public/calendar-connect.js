import { api } from '/auth-client.js';
const $ = s => document.querySelector(s);
const dialog = $('#calendar-connect-dialog');
let busy = false;
async function connection(method = 'GET') {
  if (busy) return;
  busy = true;
  $('#calendar-connect-status').textContent = method === 'DELETE' ? 'Disconnecting…' : 'Checking calendar link…';
  $('#calendar-connect-retry').hidden = true;
  for (const id of ['calendar-enable', 'calendar-disconnect']) $('#'+id).disabled = true;
  try {
    const result = await api('/api/calendar/subscription', {method, ...(method === 'GET' ? {} : {headers: {'Content-Type': 'application/json'}, body: '{}'})});
    $('#calendar-connected').hidden = !result.url;
    $('#calendar-connect-consent').hidden = !!result.url;
    $('#calendar-connect-signin').hidden = true;
    $('#calendar-feed-url').value = result.url || '';
    $('#calendar-apple').href = result.url?.replace(/^https?:/, 'webcal:') || '#';
    $('#calendar-connect-status').textContent = result.url ? 'Private link ready. Subscribe below to finish connecting your calendar.' : 'No calendar link active.';
  } catch (error) {
    $('#calendar-connect-status').textContent = error.message;
    $('#calendar-connect-signin').hidden = error.status !== 401;
    $('#calendar-connect-retry').hidden = error.status === 401;
    // A failed disconnect must not claim that sharing has stopped.
  } finally {
    busy = false;
    for (const id of ['calendar-enable', 'calendar-disconnect']) $('#'+id).disabled = false;
  }
}
window.addEventListener('tuckday-share-calendar', () => {
  $('#calendar-connected').hidden = true;
  $('#calendar-connect-consent').hidden = true;
  $('#calendar-feed-url').value = '';
  dialog.showModal();
  void connection();
});
$('#calendar-connect-close').onclick = () => dialog.close();
$('#calendar-enable').onclick = () => connection('POST');
$('#calendar-disconnect').onclick = () => connection('DELETE');
$('#calendar-connect-retry').onclick = () => connection();
$('#calendar-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('#calendar-feed-url').value);
    $('#calendar-connect-status').textContent = 'Copied. Paste it into your calendar’s subscription settings.';
  } catch {
    $('#calendar-feed-url').focus(); $('#calendar-feed-url').select();
    $('#calendar-connect-status').textContent = 'Select and copy the highlighted link.';
  }
};
