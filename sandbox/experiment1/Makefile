%.json: %.yaml
	perl -MJSON -MYAML=LoadFile -le 'print JSON->new->pretty->encode(LoadFile shift)' $< > $@

NODE_PATH=/usr/local/lib/node_modules

all: english.html legalese.html safe.mdh

HANDLEBARS=handlebars
HANDLEBARS=../../src/bin/hb

.SECONDARY:

%.mdh: %.mustache main.json
	$(HANDLEBARS) --file=$< main.json > $@

%.mdm: %.mustache main.yaml
	mustache main.yaml $< > $@

%.html: %.mdh
	markdown $< | perl -nle 'print if /\S/' > $@

legalese.html: legalese.mdh
	perl -nle 'print if /\S/' $< > $@

clean: 
	rm -f *.html *.md? *.txt *.json *~
