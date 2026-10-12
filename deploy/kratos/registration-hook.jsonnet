// Body of the registration webhook (kratos.yml): the app checks the Turnstile token before
// Kratos stores the new identity. The browser sends the token as `transient_payload.turnstile`.
function(ctx) {
  local payload = if std.objectHas(ctx.flow, 'transient_payload') && ctx.flow.transient_payload != null
    then ctx.flow.transient_payload else {},
  username: ctx.identity.traits.username,
  turnstile: if std.objectHas(payload, 'turnstile') then payload.turnstile else '',
  remote_ip: if std.objectHas(ctx.request_headers, 'X-Forwarded-For')
    then ctx.request_headers['X-Forwarded-For'][0] else '',
}
