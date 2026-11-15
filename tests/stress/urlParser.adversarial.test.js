/**
 * @file tests/stress/urlParser.adversarial.test.js
 * Empirical Challenger stress harness and adversarial validation suite for urlParser.js
 * specifically testing parseBatchUrlText trailing hashtag extraction and edge cases:
 *
 * 1. Hash in label: [#1 Best Tool](https://example.com) #top
 * 2. Hash in URL fragment: [Guide](https://example.com/docs#section-1) #docs #guide
 * 3. Multiple consecutive hashtags without space: [Site](https://example.com) #tagA#tagB
 * 4. Unicode / CJK hashtags: [工具](https://example.com) #前端開發 #實用工具
 * 5. Dashes and underscores in tags: [App](https://example.com) #my_app #v1-beta
 * 6. Trailing non-tag text: [Site](https://example.com) some plain comment #tag1
 * 7. Mixed lines: plain URLs, plain markdown without tags, CSV lines, empty lines
 * 8. ReDoS, boundary conditions, bullet variations, and pathological inputs
 */

import { parseBatchUrlText } from '../../src/js/core/urlParser.js';

describe('Empirical Challenger: urlParser.parseBatchUrlText Adversarial Suite', () => {
  describe('Vector 1: Hash in Markdown Label', () => {
    it('preserves label starting with # and extracts trailing tag without confusion', () => {
      const input = '[#1 Best Tool](https://example.com) #top';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].label).toBe('#1 Best Tool');
      expect(res.items[0].url).toBe('https://example.com/');
      expect(res.items[0].tags).toEqual(['top']);
    });

    it('preserves multiple # symbols inside label', () => {
      const input =
        '[#1 #TopWinner - Project #Alpha v2](https://example.com/project) #alpha #release';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].label).toBe('#1 #TopWinner - Project #Alpha v2');
      expect(res.items[0].tags).toEqual(['alpha', 'release']);
    });

    it('preserves C# and F# programming language names in label', () => {
      const input =
        '[Learn C# & F# in 2026](https://example.com/dotnet) #dotnet #csharp';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].label).toBe('Learn C# & F# in 2026');
      expect(res.items[0].tags).toEqual(['dotnet', 'csharp']);
    });
  });

  describe('Vector 2: Hash in URL Fragment', () => {
    it('preserves URL fragment and extracts distinct trailing tags', () => {
      const input = '[Guide](https://example.com/docs#section-1) #docs #guide';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].label).toBe('Guide');
      expect(res.items[0].url).toBe('https://example.com/docs#section-1');
      expect(res.items[0].tags).toEqual(['docs', 'guide']);
    });

    it('does not treat URL fragment as a hashtag when no trailing tags exist', () => {
      const input = '[Doc](https://example.com/manual#installation)';
      const res = parseBatchUrlText(input, { autoTag: false });

      expect(res.items).toHaveLength(1);
      expect(res.items[0].url).toBe('https://example.com/manual#installation');
      expect(res.items[0].tags).toEqual([]);
    });

    it('preserves complex SPA hash routing fragments and trailing tags', () => {
      const input =
        '[SPA App](https://example.com/app/#/dashboard?user=1#header) #spa #react';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].url).toBe(
        'https://example.com/app/#/dashboard?user=1#header'
      );
      expect(res.items[0].tags).toEqual(['spa', 'react']);
    });
  });

  describe('Vector 3: Multiple Consecutive Hashtags without Space', () => {
    it('extracts two consecutive hashtags without space', () => {
      const input = '[Site](https://example.com) #tagA#tagB';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual(['tagA', 'tagB']);
    });

    it('extracts four consecutive hashtags without space', () => {
      const input = '[Site](https://example.com) #tagA#tagB#tagC#tagD';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual(['tagA', 'tagB', 'tagC', 'tagD']);
    });

    it('extracts mixed consecutive and spaced hashtags', () => {
      const input =
        '[Site](https://example.com) #alpha#beta #gamma #delta#epsilon';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual([
        'alpha',
        'beta',
        'gamma',
        'delta',
        'epsilon',
      ]);
    });

    it('extracts hashtags directly touching markdown closing parenthesis', () => {
      const input = '[Site](https://example.com)#direct#tag2';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual(['direct', 'tag2']);
    });
  });

  describe('Vector 4: Unicode and CJK Hashtags', () => {
    it('extracts Traditional Chinese hashtags', () => {
      const input = '[工具](https://example.com) #前端開發 #實用工具';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].label).toBe('工具');
      expect(res.items[0].tags).toEqual(['前端開發', '實用工具']);
    });

    it('extracts Simplified Chinese hashtags', () => {
      const input = '[资源](https://example.com/ml) #机器学习 #自然语言处理';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].label).toBe('资源');
      expect(res.items[0].tags).toEqual(['机器学习', '自然语言处理']);
    });

    it('extracts mixed English, numbers, and CJK characters in hashtags', () => {
      const input =
        '[專案](https://example.com) #Web3區塊鏈 #第1期 #AI人工智慧_2026';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual([
        'Web3區塊鏈',
        '第1期',
        'AI人工智慧_2026',
      ]);
    });

    it('handles consecutive CJK hashtags without space', () => {
      const input = '[入口](https://example.com) #首頁#熱門推薦#限時優惠';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual(['首頁', '熱門推薦', '限時優惠']);
    });

    it('documents behavior for Japanese Kana and Korean Hangul', () => {
      // Current regex is #[\w\u4e00-\u9fa5-]+ which covers CJK Ideographs (Hanzi/Kanji)
      const inputKana = '[JP](https://example.com) #テスト #ひらがな';
      const resKana = parseBatchUrlText(inputKana, { autoTag: false });
      // Japanese Kana is outside \u4e00-\u9fa5, so explicitTags is empty
      expect(resKana.items[0].tags).toEqual([]);

      const inputHangul = '[KR](https://example.com) #한국어 #개발';
      const resHangul = parseBatchUrlText(inputHangul, { autoTag: false });
      // Korean Hangul is outside \u4e00-\u9fa5, so explicitTags is empty
      expect(resHangul.items[0].tags).toEqual([]);

      const inputKanji = '[JP Kanji](https://example.com) #東京 #開発';
      const resKanji = parseBatchUrlText(inputKanji);
      // Japanese Kanji IS within \u4e00-\u9fa5, so it works!
      expect(resKanji.items[0].tags).toEqual(['東京', '開発']);
    });

    it('documents behavior for accented Latin characters (e.g. café, über)', () => {
      const input = '[French](https://example.com) #café #über';
      const res = parseBatchUrlText(input);
      // \w stops before accented char, matching #caf from #café; #über fails match because ü is not in [\w\u4e00-\u9fa5-]
      expect(res.items[0].tags).toEqual(['caf']);
    });
  });

  describe('Vector 5: Dashes and Underscores in Tags', () => {
    it('extracts tags with underscores and dashes', () => {
      const input = '[App](https://example.com) #my_app #v1-beta';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual(['my_app', 'v1-beta']);
    });

    it('extracts tags with multiple repeating dashes and underscores', () => {
      const input =
        '[System](https://example.com) #system__core #k8s-cluster-prod-01 #_private';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual([
        'system__core',
        'k8s-cluster-prod-01',
        '_private',
      ]);
    });
  });

  describe('Vector 6: Trailing Non-Tag Text and Commentary', () => {
    it('extracts valid hashtags while ignoring commentary words', () => {
      const input =
        '[Site](https://example.com) some plain comment #tag1 and another note #tag2';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].label).toBe('Site');
      expect(res.items[0].tags).toEqual(['tag1', 'tag2']);
    });

    it('ignores lone # characters that do not form valid tags', () => {
      const input = '[Site](https://example.com) # # # #validTag';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual(['validTag']);
    });

    it('ignores trailing punctuation attached to hashtags', () => {
      const input = '[Site](https://example.com) (#tag1, #tag2!) #tag3.';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('falls back cleanly to auto-tags when line has trailing commentary without hashtags', () => {
      const input =
        '[Site](https://example.com/orders) Great service recommended by Bob';
      const res = parseBatchUrlText(input, { autoTag: true });

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toContain('orders');
      expect(res.items[0].tags).toContain('example');
    });

    it('returns empty tags when line has trailing commentary without hashtags and autoTag=false', () => {
      const input =
        '[Site](https://example.com/orders) Great service recommended by Bob';
      const res = parseBatchUrlText(input, { autoTag: false });

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual([]);
    });
  });

  describe('Vector 7: Mixed Batch and Boundary Cases', () => {
    it('processes mixed multi-format batch correctly', () => {
      const batchText = `
        # Header comment (should be ignored or fallback)
        
        [Tag Item](https://example1.com/api) #api #prod
        [Plain Item](https://example2.com/test)
        [Fragment Item](https://example3.com/docs#intro) #documentation
        
        CSV Name,https://example4.com/orders
        TSV Name\thttps://example5.com/users
        https://example6.com/plain
        
        
      `;

      const res = parseBatchUrlText(batchText, { autoTag: false });

      expect(res.stats.uniqueFound).toBe(6);
      expect(res.items[0].label).toBe('Tag Item');
      expect(res.items[0].tags).toEqual(['api', 'prod']);

      expect(res.items[1].label).toBe('Plain Item');
      expect(res.items[1].tags).toEqual([]);

      expect(res.items[2].label).toBe('Fragment Item');
      expect(res.items[2].url).toBe('https://example3.com/docs#intro');
      expect(res.items[2].tags).toEqual(['documentation']);

      expect(res.items[3].label).toBe('CSV Name');
      expect(res.items[3].url).toBe('https://example4.com/orders');

      expect(res.items[4].label).toBe('TSV Name');
      expect(res.items[4].url).toBe('https://example5.com/users');

      expect(res.items[5].url).toBe('https://example6.com/plain');
    });

    it('supports standard markdown bullet markers (-, *, •)', () => {
      const input = `
        - [Dash Bullet](https://example.com/dash) #tag-dash
        * [Star Bullet](https://example.com/star) #tag-star
        • [Dot Bullet](https://example.com/dot) #tag-dot
      `;
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(3);
      expect(res.items[0].tags).toEqual(['tag-dash']);
      expect(res.items[1].tags).toEqual(['tag-star']);
      expect(res.items[2].tags).toEqual(['tag-dot']);
    });

    it('deduplicates repeating hashtags on the same line', () => {
      const input =
        '[Dedup](https://example.com) #react #redux #react #REDUX_DUP #react';
      const res = parseBatchUrlText(input);

      expect(res.items[0].tags).toEqual(['react', 'redux', 'REDUX_DUP']);
    });

    it('deduplicates repeating URLs across lines and combines correctly', () => {
      const input = `
        [First](https://example.com/dup) #first
        [Second](https://example.com/dup) #second
      `;
      const res = parseBatchUrlText(input);

      expect(res.stats.totalFound).toBe(2);
      expect(res.stats.uniqueFound).toBe(1);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].label).toBe('First');
      expect(res.items[0].tags).toEqual(['first']);
    });

    it('merges batch commonTags with explicit markdown tags without duplicates', () => {
      const input = '[Merged](https://example.com) #tagA #tagB';
      const res = parseBatchUrlText(input, {
        commonTags: ['tagB', 'tagC', 'global'],
      });

      expect(res.items[0].tags).toEqual(['tagA', 'tagB', 'tagC', 'global']);
    });
  });

  describe('Adversarial Stress: Pathological Inputs & Performance', () => {
    it('handles 1,000 hashtags on a single line in under 200ms without catastrophic backtracking', () => {
      const tagCount = 1000;
      const tags = Array.from({ length: tagCount }, (_, i) => `#tag_${i}`).join(
        ' '
      );
      const input = `[Stress](https://example.com/stress) ${tags}`;

      const t0 = performance.now();
      const res = parseBatchUrlText(input);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(200);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toHaveLength(tagCount);
      expect(res.items[0].tags[0]).toBe('tag_0');
      expect(res.items[0].tags[tagCount - 1]).toBe(`tag_${tagCount - 1}`);
    });

    it('handles extremely long tag (2,000 characters) safely', () => {
      const longTagName = 'a'.repeat(2000);
      const input = `[Long](https://example.com) #${longTagName}`;
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].tags).toEqual([longTagName]);
    });

    it('handles line with only hashtags and no URL gracefully', () => {
      const input = '#just #some #hashtags without url';
      const res = parseBatchUrlText(input);

      expect(res.items).toHaveLength(0);
      expect(res.stats.totalFound).toBe(0);
    });

    it('handles empty string, whitespace only, null, undefined', () => {
      expect(parseBatchUrlText('').items).toEqual([]);
      expect(parseBatchUrlText('   \n\t  \n').items).toEqual([]);
      expect(parseBatchUrlText(null).items).toEqual([]);
      expect(parseBatchUrlText(undefined).items).toEqual([]);
    });
  });
});
