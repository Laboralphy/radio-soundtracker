const VLCControl = require('../src/libs/vlc-control');

describe('parseResponse', function () {
    it('should return [[\'alpha\']] when parsing [\'> alpha\']', function () {
        const v = new VLCControl();
        const a = v.parseResponse([
            '> alpha'
        ]);
        expect(a).toEqual([['alpha']]);
    });
    it('should return [["alpha", "beta"]] when parsing ["> alpha", "beta"]', function () {
        const v = new VLCControl();
        const a = v.parseResponse([
            '> alpha',
            'beta'
        ]);
        expect(a).toEqual([['alpha', 'beta']]);
    });
    it('should return [["alpha", "beta"], ["gamma"]] when parsing ["> alpha", "beta", "> gamma"]', function () {
        const v = new VLCControl();
        const a = v.parseResponse([
            '> alpha',
            'beta',
            '> gamma'
        ]);
        expect(a).toEqual([['alpha', 'beta'], ['gamma']]);
    });
    it('should return [[\'alpha');
});
