module.exports = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      minLength: 1
    }
  },
  required: [ 'type' ],
  additionalProperties: true
}
